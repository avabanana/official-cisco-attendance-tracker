import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotRecords } from '../scripts/snapshot-data.ts';

test('snapshot preserves mismatched, missing, and archived identities without overwriting a valid record', () => {
  const record = { id:'2026-10-16_student',date:'2026-10-16',studentId:'student',status:'completed',history:[{action:'check_in',timestamp:1}],laptopLogs:[{count:2}] };
  const documents = [
    {id:record.id,data:()=>record},
    {id:'legacy-alias',data:()=>({...record,extra:'preserve me'})},
    {id:'missing-fields',data:()=>({history:[{action:'reset'}]})},
    {id:'2026-10-15_student',data:()=>({...record,id:'2026-10-15_student',date:'2026-10-15',storageGeneration:'older'})},
    {id:'2026-02-30_student',data:()=>({...record,id:'2026-02-30_student',date:'2026-02-30'})},
  ];
  const before=JSON.stringify(documents.map(d=>d.data()));
  const result=snapshotRecords(documents);
  assert.equal(result.exportSummary.totalDocuments,5);
  assert.equal(result.quarantinedRecords.length,3);
  assert.deepEqual(result.recordsByDate['2026-10-16'].student,record);
  assert.equal(result.quarantinedRecords[0].documentId,'legacy-alias');
  assert.equal(result.quarantinedRecords[0].data.extra,'preserve me');
  assert.equal(JSON.stringify(documents.map(d=>d.data())),before);
  const archived=snapshotRecords(documents,'current');
  assert.equal(archived.exportSummary.archivedDocuments,5);
  assert.equal(archived.rawRecords.length,5);
  assert.equal(Object.keys(archived.recordsByDate).length,0);
});

test('stored ID mismatch is quarantined even if document path matches date/studentId',()=>{
  const result=snapshotRecords([{id:'2026-10-16_student',data:()=>({id:'wrong',date:'2026-10-16',studentId:'student',status:'absent'})}]);
  assert.equal(result.exportSummary.quarantinedDocuments,1);
  assert.match(result.quarantinedRecords[0].issues.join(','),/Stored record ID/);
});

test('correction application refuses unresolved document identities before accessing Firebase',async()=>{
  const {reconcile}=await import('../scripts/apply-reconciliation.ts');
  await assert.rejects(reconcile({} as any,{version:1,changes:[],quarantinedDocuments:1},'test',true),/Resolve quarantined/);
});
