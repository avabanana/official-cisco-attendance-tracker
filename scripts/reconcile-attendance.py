#!/usr/bin/env python3
"""Read-only CSV comparison. Never connects to Firebase or changes source files."""
import argparse, collections, csv, datetime as dt, hashlib, json, pathlib, re
from zoneinfo import ZoneInfo

FIELDS = ('status','clockInTime','clockInTimestamp','clockOutTime','clockOutTimestamp','durationMinutes','laptopsImaged','isFlagged','flagReason')
STATUSES = {'Absent':'absent','Clocked Out (Completed)':'completed','Completed':'completed','Present (Active)':'checked_in'}
def canonical(value):
    if isinstance(value, dict): return {k:canonical(v) for k,v in value.items()}
    if isinstance(value, list): return [canonical(v) for v in value]
    if isinstance(value,float) and value.is_integer(): return int(value)
    return value

def digest(value):
    return hashlib.sha256(json.dumps(canonical(value),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def normalize(name): return ' '.join(name.split()).casefold()
def timestamp(date, value):
    if not value or value == '--': return None
    value=re.sub(r'(?<=\d)(AM|PM)$',r' \1',value,flags=re.I)
    for format in ('%I:%M:%S %p','%I:%M %p','%H:%M:%S','%H:%M'):
        try: return int(dt.datetime.combine(dt.date.fromisoformat(date),dt.datetime.strptime(value,format).time(),ZoneInfo('America/Los_Angeles')).timestamp()*1000)
        except ValueError: pass
    raise ValueError('Unrecognized time format: '+value)
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--csv-dir',required=True);p.add_argument('--snapshot',required=True);p.add_argument('--out',required=True)
    p.add_argument('--baseline',choices=['repository-backup-not-live','firebase-read-only-snapshot'],default='repository-backup-not-live')
    args=p.parse_args(); source=pathlib.Path(args.snapshot); snapshot=json.loads(source.read_text()); days=snapshot['recordsByDate']
    identities=collections.defaultdict(set)
    for records in days.values():
        for r in records.values(): identities[normalize(r['studentName'])].add(r['studentId'])
    report=[];changes=[];sources=[];issues=[]
    for file in sorted(pathlib.Path(args.csv_dir).rglob('*.csv'),key=lambda p:p.name):
        match=re.search(r'\d{4}-\d{2}-\d{2}',file.name)
        if not match: continue
        date=match.group();dt.date.fromisoformat(date)
        raw=file.read_bytes();sources.append({'file':file.name,'sha256':hashlib.sha256(raw).hexdigest(),'date':date})
        uncertain='inaccurate' in file.name.lower() or 'data lost' in file.name.lower()
        with file.open(encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
        stats={'date':date,'file':file.name,'rows':len(rows),'uncertain':uncertain,'changed':0,'unmatched':0,'invalid':0,'attended':0}
        seen=set()
        for index,row in enumerate(rows,2):
            name=row['Student Name']; matches=identities[normalize(name)]
            if len(matches)!=1:
                stats['unmatched']+=1;issues.append({'date':date,'row':index,'name':name,'issue':'No unique exact roster identity; no fuzzy match applied'});continue
            id=next(iter(matches))
            if id in seen:
                stats['invalid']+=1;issues.append({'date':date,'row':index,'name':name,'issue':'Duplicate student row'});continue
            seen.add(id);before=days.get(date,{}).get(id)
            try:
                status=STATUSES[row['Status']];start=(row['Clock In Time'] or '').strip();end=(row['Clock Out Time'] or '').strip()
                startts=timestamp(date,start);endts=timestamp(date,end)
                if status=='absent' and (startts or endts): raise ValueError('Absent row contains attendance times')
                if status=='completed' and (not startts or not endts or endts<startts): raise ValueError('Completed row has missing/reversed times')
                if status=='checked_in' and (not startts or endts): raise ValueError('Active row must have arrival and no departure')
                duration=(row.get('Duration') or '').strip()
                if duration:
                    match=re.fullmatch(r'([0-9]+(?:\.[0-9]+)?)\s*hrs?',duration,re.I)
                    if not match: raise ValueError('Unrecognized duration')
                    minutes=round(float(match[1])*60)
                else: minutes=None
                laptops=int(row.get('Laptops Imaged (Session)') or 0)
                if laptops<0 or laptops>500: raise ValueError('Invalid laptop count')
                values={'status':status,'clockInTime':start or None,'clockInTimestamp':startts,'clockOutTime':end or None,
                  'clockOutTimestamp':endts,'durationMinutes':minutes,'laptopsImaged':laptops,
                  'isFlagged':(row.get('Flagged Proxy Alert') or row.get('Flagged') or '').upper().startswith('YES'),
                  'flagReason':(row.get('Flag Reason') or '').strip() or None}
                # CSV exports round timestamps to seconds and vary leading-zero formatting.
                # Preserve equivalent source values rather than rewriting real event precision.
                if before:
                    for time_key, stamp_key in [('clockInTime','clockInTimestamp'),('clockOutTime','clockOutTimestamp')]:
                        incoming=values[stamp_key]
                        old_stamp=before.get(stamp_key)
                        if incoming is not None and isinstance(old_stamp,(int,float)) and int(old_stamp//1000)==incoming//1000:
                            values[stamp_key]=old_stamp
                        try:
                            if timestamp(date,before.get(time_key))==incoming:
                                values[time_key]=before.get(time_key)
                        except (ValueError,TypeError):
                            pass
                stats['attended']+=status!='absent'
                changed=[field for field in FIELDS if (before or {}).get(field)!=values[field]]
                # A missing absent/zero row is an implicit absence, not a record needing creation.
                if not before and status=='absent' and not laptops and not values['isFlagged']: continue
                if changed:
                    stats['changed']+=1
                    if not uncertain:
                        after=dict(before or {'id':date+'_'+id,'date':date,'studentId':id,'studentName':name,'checkedInByClientId':None,'checkedOutByClientId':None,'history':[],'laptopLogs':[]})
                        after.update(values)
                        after['completedSessionMinutes']=0
                        changes.append({'date':date,'studentId':id,'id':date+'_'+id,'source':file.name,'sourceSha256':hashlib.sha256(raw).hexdigest(),
                          'row':index,'changedFields':changed,'beforeSha256':digest(before),'before':before,'after':after})
            except (ValueError,KeyError) as e:
                stats['invalid']+=1;issues.append({'date':date,'row':index,'name':name,'issue':str(e)})
        report.append(stats)
    plan={'version':1,'quarantinedDocuments':len(snapshot.get('quarantinedRecords',[])),'baseline':args.baseline,'baselineSha256':digest(snapshot),'sources':sources,'changes':changes,'issues':issues,'summary':report,
      'notes':['No Firebase or source files were modified.','Files marked inaccurate/data lost are comparison-only and excluded from corrections.',
       'No data was inferred for October 13 or any other missing date.','Missing rows do not establish absence for people not listed in that sheet.',
       'Existing check-in/check-out history and laptop logs are retained. CSVs cannot reconstruct lost event/device history.',
       'Apply requires review, explicit plan hash approval, fresh per-record conflict checks, and transactional backups.']}
    out=pathlib.Path(args.out);out.mkdir(parents=True,exist_ok=True)
    target=out/'correction-plan.json';target.write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n');target.chmod(0o600)
    lines=['# Attendance reconciliation review','',f'Baseline: **{args.baseline}**. Comparison reflects the exported snapshot, not subsequent live changes.','',
      '| Date | CSV rows | Valid matched attendees | Differences | Unmatched | Invalid | Correction policy |','|---|---:|---:|---:|---:|---:|---|']
    for s in report:lines.append(f"| {s['date']} | {s['rows']} | {s['attended']} | {s['changed']} | {s['unmatched']} | {s['invalid']} | {'Review only: inaccurate source' if s['uncertain'] else 'Proposed corrections'} |")
    lines+=['',f"Live documents requiring identity review: **{len(snapshot.get('quarantinedRecords',[]))}**. No correction plan may be applied until these are resolved.",'',f'Proposed record corrections: **{len(changes)}**. Unresolved rows: **{len(issues)}**.','']+plan['notes']
    lines+=['','The October 12 filename says “missing 10-13”; it supplies evidence for October 12 only.','',f'Plan file SHA-256: `{hashlib.sha256(target.read_bytes()).hexdigest()}`']
    (out/'REVIEW.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'plan':str(target),'corrections':len(changes),'unresolved':len(issues),'dates':len(report)}))
if __name__=='__main__':main()
