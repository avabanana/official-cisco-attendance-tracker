import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AttendanceDatabase, emptyStore } from '../storage.ts';
function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('commits survive reopen, concurrent connections reload, failures roll back', t => {
  const filename = path.join(fixture(t), 'test.sqlite');
  const a = new AttendanceDatabase(filename), b = new AttendanceDatabase(filename);
  a.transaction(s => { s.settings.strictMode = true; });
  b.transaction(s => { assert.equal(s.settings.strictMode, true); s.settings.soundAlerts = false; });
  assert.throws(() => a.transaction(s => { s.settings.strictMode = false; throw new Error('failure'); }));
  a.close(); b.close();
  const c = new AttendanceDatabase(filename);
  c.transaction(s => { assert.equal(s.settings.strictMode, true); assert.equal(s.settings.soundAlerts, false); });
  c.close();
});
test('migration preserves complete payload/source and refuses repeated import', t => {
  const dir = fixture(t), source = path.join(dir, 'legacy.json');
  const legacy = emptyStore();
  legacy.recordsByDate['2026-01-01'] = { abc: {
    id: '2026-01-01_abc', date: '2026-01-01', studentId: 'abc', studentName: 'Test',
    status: 'completed', clockInTime: '09:00', clockOutTime: '10:00', clockInTimestamp: 1,
    clockOutTimestamp: 2, durationMinutes: 60, checkedInByClientId: 'device', checkedOutByClientId: 'device',
    isFlagged: true, history: [{ action: 'check_in', timestamp: 1, timeFormatted: '09:00', clientId: 'device' }],
  } };
  const bytes = JSON.stringify(legacy); fs.writeFileSync(source, bytes);
  const db = new AttendanceDatabase(path.join(dir, 'test.sqlite'));
  db.importLegacy(source);
  db.transaction(s => assert.equal(JSON.stringify(s), bytes));
  assert.throws(() => db.importLegacy(source), /already initialized/);
  assert.equal(fs.readFileSync(source, 'utf8'), bytes); db.close();
});
test('malformed migration fails closed without initializing or changing source', t => {
  const dir = fixture(t), source = path.join(dir, 'legacy.json');
  const db = new AttendanceDatabase(path.join(dir, 'test.sqlite'));
  for (const bytes of ['{', '{"recordsByDate":[],"alerts":[],"settings":{}}']) {
    fs.writeFileSync(source, bytes); assert.throws(() => db.importLegacy(source));
    assert.equal(db.isInitialized(), false); assert.equal(fs.readFileSync(source, 'utf8'), bytes);
  }
  db.close();
});

test('separate writer processes serialize without losing updates', async t => {
  const { spawn } = await import('node:child_process');
  const filename = path.join(fixture(t), 'concurrent.sqlite');
  const seed = new AttendanceDatabase(filename); seed.transaction(() => {}); seed.close();
  const code = `import { AttendanceDatabase } from './storage.ts';
    const db = new AttendanceDatabase(process.argv[1]);
    for (let i=0;i<20;i++) db.transaction(s => { s.settings.counter=(s.settings.counter || 0)+1; });
    db.close();`;
  await Promise.all(Array.from({ length: 3 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, filename]);
    let errors = ''; child.stderr.on('data', b => { errors += b; });
    child.on('error', reject);
    child.on('exit', status => status === 0 ? resolve() : reject(new Error(errors)));
  })));
  const db = new AttendanceDatabase(filename);
  db.transaction(s => assert.equal((s.settings as any).counter, 60)); db.close();
});
