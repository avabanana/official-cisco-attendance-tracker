import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blank, checkIn, checkOut } from '../server/attendance.ts';
import { attendanceMap, canCheckIn } from '../src/utils/attendanceState.ts';
const student = {id:'test-person',name:'Person, Test',firstName:'Test',lastName:'Person'};
test('explicit re-in clears departure, retains history and adds only active-session minutes', () => {
  const r=blank('2026-10-16',student);
  assert.equal(r.status,'absent');assert.equal(canCheckIn(r),true);
  checkIn(r,Date.parse('2026-10-16T22:00:00Z'),'device');
  const before=structuredClone(r);checkIn(r,Date.parse('2026-10-16T22:01:00Z'),'device');
  assert.deepEqual(r,before);assert.equal(canCheckIn(r),false);
  checkOut(r,Date.parse('2026-10-16T22:30:00Z'),'device');assert.equal(canCheckIn(r),true);
  checkIn(r,Date.parse('2026-10-16T22:45:00Z'),'device');
  assert.equal(r.clockOutTime,null);assert.equal(r.clockOutTimestamp,null);assert.equal(r.status,'checked_in');
  checkOut(r,Date.parse('2026-10-16T23:00:00Z'),'device');
  assert.equal(r.durationMinutes,45);assert.deepEqual(r.history!.map(e=>e.action),['check_in','check_out','check_in','check_out']);
});
test('date isolation rejects stale records; absence from server replaces previous activity',()=>{
  const r=blank('2026-10-15',student);checkIn(r,Date.parse('2026-10-15T22:00:00Z'),'device');
  assert.throws(()=>attendanceMap('2026-10-16',[r]),/different date/);
  assert.equal(attendanceMap('2026-10-16',[blank('2026-10-16',student)])[student.id].status,'absent');
});
