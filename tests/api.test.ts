import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';

test('API history, settings, strict security, SSE, rollback, and restart persistence', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-api-'));
  const database = path.join(dir, 'test.sqlite');
  const portServer = createServer();
  await new Promise<void>(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = (portServer.address() as any).port;
  await new Promise<void>(resolve => portServer.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  let child: ReturnType<typeof spawn>;
  let logs = '';
  const start = async () => {
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      env: { ...process.env, NODE_ENV: 'production', ATTENDANCE_STORAGE: 'sqlite', ADMIN_PASSWORD: 'test-only-strong-password', PORT: String(port), ATTENDANCE_DB_PATH: database },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', b => { logs += b; });
    child.stderr!.on('data', b => { logs += b; });
    for (let i = 0; i < 400; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(url + '/api/roster')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Startup timed out: ' + logs);
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); await exited;
    }
  };
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = async (endpoint: string) => (await fetch(url + endpoint)).json();
  const post = async (endpoint: string, body: any) => {
    const response = await fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': 'test-only-strong-password' }, body: JSON.stringify({ ...body, ...(['/api/checkin','/api/checkout'].includes(endpoint) ? { intent: 'manual' } : {}) }) });
    return { status: response.status, body: await response.json() };
  };
  await start();
  const { roster } = await get('/api/roster');
  const first = roster[0].id, second = roster[1].id;
  const date = '2026-01-02';
  const invalidSettings = await post('/api/settings', { rapidThresholdSeconds: -1 });
  assert.equal(invalidSettings.status, 400);
  const unauthorized = await fetch(url + '/api/checkin', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:first,date,clientId:'device',intent:'manual',isAdminOverride:true})});
  assert.equal(unauthorized.status,401);
  const initial = await get('/api/attendance?date=' + date);
  assert.equal(initial.records.length, roster.length);
  assert.equal((await post('/api/checkout', { studentId: first, date })).status, 400);
  assert.equal((await post('/api/checkin', { studentId: 'missing', date })).status, 404);
  const abort = new AbortController();
  const stream = await fetch(url + '/api/events', { signal: abort.signal });
  const reader = stream.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: connected/);
  await post('/api/settings', { strictMode: true });
  assert.match(new TextDecoder().decode((await reader.read()).value), /settings_updated/);
  const checked = await post('/api/checkin', { studentId: first, date, clientId: 'device' });
  assert.equal(checked.body.record.history[0].action, 'check_in');
  const blocked = await post('/api/checkin', { studentId: second, date, clientId: 'device' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.flagged, true);
  abort.abort(); await reader.cancel().catch(() => {});
  const checkout = await post('/api/checkout', { studentId: first, date, clientId: 'device' });
  assert.equal(checkout.body.record.status, 'completed');
  assert.equal(checkout.body.record.history.length, 2);
  const reentered = await post('/api/checkin', { studentId: first, date, clientId: 'device' });
  assert.equal(reentered.body.record.status, 'checked_in');
  assert.equal(reentered.body.record.clockOutTime, null);
  assert.equal(reentered.body.record.clockOutTimestamp, null);
  assert.equal(reentered.body.record.history.length, 3);
  const duplicate = await post('/api/checkin', { studentId: first, date, clientId: 'device' });
  assert.deepEqual(duplicate.body.record, reentered.body.record);
  const checkedAgain = await post('/api/checkout', { studentId: first, date, clientId: 'device' });
  assert.equal(checkedAgain.body.record.history.length, 4);
  checkout.body.record = checkedAgain.body.record;
  await stop(); await start();
  assert.equal((await get('/api/settings')).strictMode, true);
  assert.equal((await post('/api/checkin', { studentId: second, date, clientId: 'device' })).status, 403);
  const stored = (await get('/api/attendance?date=' + date)).records.find((r: any) => r.studentId === first);
  assert.deepEqual(stored.history, checkout.body.record.history);
  const alerts = await get('/api/alerts'); assert.equal(alerts.alerts.filter((a: any) => a.type === 'RAPID_CHECKIN').length, 2);
  const acknowledged = await post('/api/alerts/acknowledge', { alertId: alerts.alerts[0].id });
  assert.equal(acknowledged.body.alerts[0].acknowledged, true);
  await post('/api/settings', { strictMode: false });
  const flagged = await post('/api/checkin', { studentId: second, date, clientId: 'device' });
  assert.equal(flagged.body.record.isFlagged, true);
  assert.equal((await post('/api/adjust-time', { studentId: first, date, clockInTime:'99:99' })).status,400);
  await post('/api/adjust-time', { studentId: first, date, clockInTime: '09:00', clockOutTime: '10:00', isFlagged: false });
  const csv = await fetch(url + '/api/export-csv?date=' + date);
  assert.match(csv.headers.get('content-type')!, /text\/csv/); assert.match(await csv.text(), /09:00,10:00/);
  // A database write failure must not produce success, events, or a cached mutation.
  const failureAbort = new AbortController();
  const failureStream = await fetch(url + '/api/events', { signal: failureAbort.signal });
  const failureReader = failureStream.body!.getReader();
  await failureReader.read();
  const db = new DatabaseSync(database);
  db.exec("CREATE TRIGGER reject_updates BEFORE UPDATE ON attendance_state BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
  assert.equal((await post('/api/reset-student', { studentId: first, date })).status, 503);
  db.exec('DROP TRIGGER reject_updates'); db.close();
  await post('/api/settings', { strictMode: false });
  assert.match(new TextDecoder().decode((await failureReader.read()).value), /event: settings_updated/);
  failureAbort.abort(); await failureReader.cancel().catch(() => {});
  const after = (await get('/api/attendance?date=' + date)).records.find((r: any) => r.studentId === first);
  assert.equal(after.status, 'completed'); assert.equal(after.history.length, 5);
  const reset = await post('/api/reset-student', { studentId: first, date });
  assert.equal(reset.body.record.status, 'absent'); assert.equal(reset.body.record.history.at(-1).action, 'reset');
  assert.deepEqual((await post('/api/alerts/clear', {})).body, { success: true, alerts: [] });
});
