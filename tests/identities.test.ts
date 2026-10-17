import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identityRepairs} from '../scripts/repair-confirmed-identities.ts';
import {CLUB_ROSTER} from '../src/data/roster.ts';

test('confirmed roster has one Isaac and retains Canul without the erroneous Canuel',()=>{
  assert.equal(CLUB_ROSTER.filter(s=>s.name==='Storment, Isaac').length,1);
  assert.equal(CLUB_ROSTER.find(s=>s.name==='Storment, Isaac')!.id,'storment');
  assert.ok(CLUB_ROSTER.some(s=>s.name==='Canul, Alfredo'));
  assert.ok(!CLUB_ROSTER.some(s=>s.name==='Canuel, Alfredo'));
});
test('identity repair preserves the complete alias session and rejects two active sessions',()=>{
  const source={id:'2026-10-13_storment-isaac',date:'2026-10-13',studentId:'storment-isaac',studentName:'Storment, Isaac',
    status:'completed',durationMinutes:88,laptopsImaged:3,history:[{action:'check_in',timestamp:1}],laptopLogs:[{count:3}]};
  const target={id:'2026-10-13_storment',date:'2026-10-13',studentId:'storment',studentName:'Storment, Isaac',status:'absent'};
  const snapshot={recordsByDate:{'2026-10-13':{'storment-isaac':source,storment:target}}};
  const bytes=JSON.stringify(snapshot);const repairs=identityRepairs(snapshot);
  assert.equal(repairs.length,1);assert.deepEqual(repairs[0].after,{...source,id:target.id,studentId:'storment'});
  assert.equal(JSON.stringify(snapshot),bytes);
  target.status='completed';assert.throws(()=>identityRepairs(snapshot),/manual conflict review/);
});
