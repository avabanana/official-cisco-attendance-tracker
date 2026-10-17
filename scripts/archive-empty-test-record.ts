/** Read-only unless explicitly approved. Archives only the known empty test-rec-1 alias. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {firebaseDatabase} from '../server/persistence.ts';
import {digest} from './apply-reconciliation.ts';
export function emptyTestRepair(snapshot:any) {
  const entries=snapshot.rawRecords.filter((record:any)=>record.documentId==='test-rec-1');
  if(entries.length!==1)throw new Error('Expected exactly one test-rec-1 document in the reviewed snapshot');
  const source=entries[0].data;
  if(source.id!=='test-rec-1' || typeof source.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.date) ||
      typeof source.studentId!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(source.studentId))throw new Error('Unexpected test record identity');
  if(source.status!=='absent' || source.clockInTime || source.clockOutTime || source.clockInTimestamp || source.clockOutTimestamp ||
      source.durationMinutes || source.laptopsImaged || source.isFlagged || source.flagReason || source.history?.length || source.laptopLogs?.length)throw new Error('Test record contains activity or flags; manual review required');
  const canonical=snapshot.recordsByDate[source.date]?.[source.studentId];
  if(!canonical || canonical.id!==`${source.date}_${source.studentId}` || canonical.date!==source.date ||
      canonical.studentId!==source.studentId || canonical.studentName!==source.studentName)throw new Error('Matching canonical attendance identity required');
  return {sourceId:'test-rec-1',source,canonicalId:canonical.id,canonical};
}
export async function archiveEmptyTest(db:ReturnType<typeof firebaseDatabase>,repair:ReturnType<typeof emptyTestRepair>,apply=false) {
  // Revalidate even for programmatic callers. No arbitrary document deletion is accepted.
  const validated=emptyTestRepair({rawRecords:[{documentId:repair.sourceId,data:repair.source}],recordsByDate:{[repair.source.date]:{[repair.source.studentId]:repair.canonical}}});
  if(repair.canonicalId!==validated.canonicalId)throw new Error('Unexpected canonical document path');
  const archiveId=digest(repair);
  return db.runTransaction(async transaction=>{
    const [source,canonical,archive]=await transaction.getAll(db.doc('attendance_records/test-rec-1'),db.doc(`attendance_records/${repair.canonicalId}`),db.doc(`attendance_test_archives/${archiveId}`));
    if(archive.exists && !source.exists)return {archived:0,alreadyArchived:true};
    if(archive.exists)throw new Error('Test record was recreated after an earlier archive; fresh review required');
    if(digest(source.exists?source.data():null)!==digest(repair.source) || digest(canonical.exists?canonical.data():null)!==digest(repair.canonical))throw new Error('Record changed since export; refusing cleanup without a fresh snapshot');
    if(apply) {
      transaction.create(archive.ref,{sourceBefore:repair.source,canonicalBefore:repair.canonical,sourceId:repair.sourceId,canonicalId:repair.canonicalId,archivedAt:Date.now(),reason:'Approved removal of empty noncanonical test alias; valid attendance unchanged'});
      transaction.delete(source.ref);
    }
    return {archived:apply?1:0,alreadyArchived:false};
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file=process.argv[2];if(!file)throw new Error('Usage: tsx scripts/archive-empty-test-record.ts <reviewed-snapshot.json> [--archive-approved-empty-test]');
  const repair=emptyTestRepair(JSON.parse(fs.readFileSync(file,'utf8')));
  const db=firebaseDatabase();
  try{console.log(JSON.stringify(await archiveEmptyTest(db,repair,process.argv.includes('--archive-approved-empty-test'))));}
  finally{await db.terminate();}
}
