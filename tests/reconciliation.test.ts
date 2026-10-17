import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('CSV planning is read-only, quarantines inaccurate input, retains history, and never copies dates',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-test-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const input=path.join(folder,'input');fs.mkdirSync(input);
  const header='Student Name,Status,Clock In Time,Clock Out Time,Duration,Laptops Imaged (Session),Flagged Proxy Alert,Flag Reason\n';
  const csv=header+'"Person, Test",Clocked Out (Completed),03:00:00 PM,04:00:00 PM,1.00 hrs,2,No,\n';
  fs.writeFileSync(path.join(input,'attendance_2026-10-12 (missing 10-13).csv'),csv);
  fs.writeFileSync(path.join(input,'attendance_2026-09-25 (inaccurate).csv'),csv);
  const source=path.join(folder,'baseline.json');
  const history=[{action:'check_in',timestamp:1,clientId:'original',timeFormatted:'original'}];
  const baseline={recordsByDate:{'2026-10-12':{'test-person':{id:'2026-10-12_test-person',studentId:'test-person',date:'2026-10-12',studentName:'Person, Test',history}}}};
  const bytes=JSON.stringify(baseline);fs.writeFileSync(source,bytes);
  const result=spawnSync('python3',['scripts/reconcile-attendance.py','--csv-dir',input,'--snapshot',source,'--out',path.join(folder,'out')]);
  assert.equal(result.status,0,result.stderr.toString());
  const plan=JSON.parse(fs.readFileSync(path.join(folder,'out/correction-plan.json'),'utf8'));
  assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].date,'2026-10-12');
  assert.deepEqual(plan.changes[0].after.history,history);assert.equal(plan.changes[0].after.laptopsImaged,2);
  assert.equal(fs.readFileSync(source,'utf8'),bytes);
});

test('CSV comparison preserves equivalent time formatting and real millisecond precision',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-time-test-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const input=path.join(folder,'input');fs.mkdirSync(input);
  fs.writeFileSync(path.join(input,'attendance_2026-10-15.csv'),
    'Student Name,Status,Clock In Time,Clock Out Time,Duration,Laptops Imaged (Session),Flagged Proxy Alert,Flag Reason\n'+
    '"Person, Test",Clocked Out (Completed),3:00:00 PM,4:00:00 PM,1.00 hrs,2,No,\n');
  const record={id:'2026-10-15_test-person',date:'2026-10-15',studentId:'test-person',studentName:'Person, Test',status:'completed',
    clockInTime:'03:00:00 PM',clockOutTime:'04:00:00 PM',clockInTimestamp:Date.parse('2026-10-15T22:00:00Z')+584,
    clockOutTimestamp:Date.parse('2026-10-15T23:00:00Z')+18,durationMinutes:60,laptopsImaged:2,isFlagged:false,flagReason:null};
  const source=path.join(folder,'baseline.json');fs.writeFileSync(source,JSON.stringify({recordsByDate:{'2026-10-15':{'test-person':record}}}));
  const result=spawnSync('python3',['scripts/reconcile-attendance.py','--csv-dir',input,'--snapshot',source,'--out',path.join(folder,'out')]);
  assert.equal(result.status,0,result.stderr.toString());
  const plan=JSON.parse(fs.readFileSync(path.join(folder,'out/correction-plan.json'),'utf8'));
  assert.equal(plan.changes.length,0);
});

test('confirmed identity policy ignores erroneous Alfredo rows rather than erasing correct attendance',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reconcile-identity-test-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const input=path.join(folder,'input');fs.mkdirSync(input);
  fs.writeFileSync(path.join(input,'attendance_2026-10-05.csv'),
    'Student Name,Status,Clock In Time,Clock Out Time,Duration,Laptops Imaged (Session),Flagged Proxy Alert,Flag Reason\n'+
    '"Canuel, Alfredo",Absent,,,,0,No,\n'+
    '"Canul, Alfredo",Clocked Out (Completed),3:00 PM,4:00 PM,1.00 hrs,0,No,\n'+
    '"Storment, Isaac",Absent,,,,0,No,\n');
  const baseline={recordsByDate:{'2026-10-05':{
    'canul-alfredo':{id:'2026-10-05_canul-alfredo',date:'2026-10-05',studentId:'canul-alfredo',studentName:'Canul, Alfredo',status:'completed',
      clockInTime:'3:00 PM',clockOutTime:'4:00 PM',clockInTimestamp:Date.parse('2026-10-05T22:00:00Z'),clockOutTimestamp:Date.parse('2026-10-05T23:00:00Z'),durationMinutes:60,laptopsImaged:0,isFlagged:false},
    storment:{id:'2026-10-05_storment',date:'2026-10-05',studentId:'storment',studentName:'Storment, Isaac',status:'absent',laptopsImaged:0,isFlagged:false},
    'storment-isaac':{id:'2026-10-05_storment-isaac',date:'2026-10-05',studentId:'storment-isaac',studentName:'Storment, Isaac',status:'absent'}
  }}};
  const source=path.join(folder,'baseline.json');fs.writeFileSync(source,JSON.stringify(baseline));
  const result=spawnSync('python3',['scripts/reconcile-attendance.py','--csv-dir',input,'--snapshot',source,'--out',path.join(folder,'out')]);
  assert.equal(result.status,0,result.stderr.toString());const plan=JSON.parse(fs.readFileSync(path.join(folder,'out/correction-plan.json'),'utf8'));
  assert.equal(plan.ignoredRows.length,1);assert.equal(plan.issues.length,0);assert.equal(plan.changes.length,0);
});
