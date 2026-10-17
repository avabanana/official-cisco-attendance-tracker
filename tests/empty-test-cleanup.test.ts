import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyTestRepair} from '../scripts/archive-empty-test-record.ts';
function fixture(){
  const source={id:'test-rec-1',date:'2026-10-12',studentId:'hua-gio',studentName:'Hua, Gio',status:'absent',laptopsImaged:0};
  const canonical={...source,id:'2026-10-12_hua-gio',status:'completed',durationMinutes:75};
  return {rawRecords:[{documentId:'test-rec-1',data:source}],recordsByDate:{'2026-10-12':{'hua-gio':canonical}}};
}
test('cleanup selects only the empty test alias and preserves its canonical counterpart',()=>{
  const snapshot=fixture(),bytes=JSON.stringify(snapshot);const repair=emptyTestRepair(snapshot);
  assert.equal(repair.sourceId,'test-rec-1');assert.equal(repair.canonicalId,'2026-10-12_hua-gio');
  assert.equal(repair.canonical.durationMinutes,75);assert.equal(JSON.stringify(snapshot),bytes);
});
test('cleanup refuses activity, missing canonical records, and conflicting names',()=>{
  const snapshot=fixture();snapshot.rawRecords[0].data.laptopsImaged=1;
  assert.throws(()=>emptyTestRepair(snapshot),/contains activity/);
  const missing=fixture();delete missing.recordsByDate['2026-10-12']['hua-gio'];assert.throws(()=>emptyTestRepair(missing),/canonical attendance/);
  const names=fixture();names.recordsByDate['2026-10-12']['hua-gio'].studentName='Different person';assert.throws(()=>emptyTestRepair(names),/canonical attendance/);
});
