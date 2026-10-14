import express from 'express';
import fs from 'node:fs';
import { AttendanceDatabase, type StoreData } from './storage.ts';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { CLUB_ROSTER } from './src/data/roster.ts';
import { AttendanceRecord, SecurityAlert } from './src/types.ts';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

// Every API operation reads and writes under a SQLite transaction.
const database = new AttendanceDatabase(process.env.ATTENDANCE_DB_PATH || path.join(process.cwd(), 'data', 'attendance.sqlite'));
if (fs.existsSync(path.join(process.cwd(), 'attendance_store.json')) && !database.isInitialized()) {
  database.close();
  throw new Error('Legacy attendance_store.json found. Explicitly import it into the selected database before starting; no attendance data was changed.');
}
let store: StoreData;
let pendingEvents: Array<[string, any]> | null = null;

function route(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    let response: { kind: 'json' | 'send'; body: any } | undefined;
    const buffered = new Proxy(res, {
      get(target, property) {
        if (property === 'json' || property === 'send') return (body: any) => {
          response = { kind: property, body };
          return buffered;
        };
        if (property === 'status') return (code: number) => { target.statusCode = code; return buffered; };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    pendingEvents = [];
    try {
      database.transaction((current) => {
        store = current;
        handler(req, buffered, next);
      });
      const events = pendingEvents;
      pendingEvents = null;
      for (const [type, data] of events) broadcast(type, data);
      if (response) res[response.kind](response.body);
    } catch (error) {
      pendingEvents = null;
      console.error('Attendance operation failed:', error);
      res.removeHeader('Content-Disposition');
      res.setHeader('Content-Type', 'application/json');
      res.status(503).json({ error: 'Attendance storage unavailable. Please retry.' });
    }
  };
}

// SSE clients for real-time live events
const sseClients = new Set<express.Response>();

function broadcast(eventType: string, data: any) {
  if (pendingEvents) { pendingEvents.push([eventType, structuredClone(data)]); return; }
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function initDayRecords(dateStr: string): Record<string, AttendanceRecord> {
  if (!store.recordsByDate[dateStr]) {
    store.recordsByDate[dateStr] = Object.create(null);
  }
  const dayRecords = store.recordsByDate[dateStr];

  for (const student of CLUB_ROSTER) {
    if (!dayRecords[student.id]) {
      dayRecords[student.id] = {
        id: `${dateStr}_${student.id}`,
        date: dateStr,
        studentId: student.id,
        studentName: student.name,
        clockInTime: null,
        clockInTimestamp: null,
        clockOutTime: null,
        clockOutTimestamp: null,
        durationMinutes: null,
        status: 'absent',
        checkedInByClientId: null,
        checkedOutByClientId: null,
        isFlagged: false,
        history: [],
      };
    }
  }
  return dayRecords;
}

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

// SSE stream for real-time updates to Admin and Student views
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);

  // Send initial ping
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Get Roster
app.get('/api/roster', (_req, res) => {
  res.json({ roster: CLUB_ROSTER });
});

// Get Settings
app.get('/api/settings', route((_req, res) => {
  res.json(store.settings);
}));

// Update Settings
app.post('/api/settings', route((req, res) => {
  store.settings = { ...store.settings, ...req.body };
  broadcast('settings_updated', store.settings);
  res.json(store.settings);
}));

// Get attendance for specific date
app.get('/api/attendance', route((req, res) => {
  const dateStr = (req.query.date as string) || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);
  const recordsList = Object.values(dayRecords);
  res.json({ date: dateStr, records: recordsList });
}));

// Check-in endpoint
app.post('/api/checkin', route((req, res) => {
  const { studentId, date, clientId } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);

  // Detect proxy/rapid clicks from the same client
  let flagReason = '';
  let generatedAlert: SecurityAlert | null = null;
  const clientKey = clientId || req.ip || 'unknown-client';
  const previousClick = store.recentClicks[clientKey];

  if (previousClick && previousClick.studentId !== studentId) {
    const diffSeconds = Math.round((now - previousClick.timestamp) / 1000);

    if (diffSeconds <= store.settings.rapidThresholdSeconds) {
      // Alert triggered!
      flagReason = `Rapid check-in detected (${diffSeconds}s after ${previousClick.studentName})`;
      generatedAlert = {
        id: `alert-${now}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        date: dateStr,
        timeFormatted: formattedTime,
        type: 'RAPID_CHECKIN',
        severity: diffSeconds <= 5 ? 'critical' : 'warning',
        currentStudent: record.studentName,
        previousStudent: previousClick.studentName,
        timeDiffSeconds: diffSeconds,
        clientId: clientKey,
        message: `Multiple student check-ins detected! "${record.studentName}" was checked in ${diffSeconds} seconds after "${previousClick.studentName}" from the same terminal/device.`,
        acknowledged: false,
      };

      store.alerts.unshift(generatedAlert);
      if (store.alerts.length > 200) store.alerts.pop();

      // If strict mode is enabled, block the action
      if (store.settings.strictMode) {
        broadcast('security_alert', generatedAlert);
        return res.status(403).json({
          error: `Multiple student check-in prohibited! Only one student may check in per device within ${store.settings.rapidThresholdSeconds}s. An alert has been sent to the club administrator.`,
          flagged: true,
          alert: generatedAlert,
        });
      }
    }
  }

  // Update record
  record.clockInTime = formattedTime;
  record.clockInTimestamp = now;
  record.status = 'checked_in';
  record.checkedInByClientId = clientKey;
  if (flagReason) {
    record.isFlagged = true;
    record.flagReason = flagReason;
  }
  record.history = record.history || [];
  record.history.push({
    action: 'check_in',
    timestamp: now,
    timeFormatted: formattedTime,
    clientId: clientKey,
  });

  // Track client click for subsequent rate detection
  store.recentClicks[clientKey] = {
    studentId,
    studentName: record.studentName,
    timestamp: now,
  };

  // Real-time broadcast
  broadcast('record_updated', record);
  if (generatedAlert) {
    broadcast('security_alert', generatedAlert);
  }

  res.json({
    success: true,
    record,
    alert: generatedAlert,
  });
}));

// Check-out endpoint
app.post('/api/checkout', route((req, res) => {
  const { studentId, date, clientId } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  if (!record.clockInTimestamp) {
    return res.status(400).json({ error: 'Student must check in before checking out' });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);
  const clientKey = clientId || req.ip || 'unknown-client';

  const durationMs = now - record.clockInTimestamp;
  const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

  record.clockOutTime = formattedTime;
  record.clockOutTimestamp = now;
  record.durationMinutes = durationMinutes;
  record.status = 'completed';
  record.checkedOutByClientId = clientKey;
  record.history = record.history || [];
  record.history.push({
    action: 'check_out',
    timestamp: now,
    timeFormatted: formattedTime,
    clientId: clientKey,
  });

  broadcast('record_updated', record);

  res.json({
    success: true,
    record,
  });
}));

// Reset a student's check-in/out for the day
app.post('/api/reset-student', route((req, res) => {
  const { studentId, date } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found' });
  }

  record.clockInTime = null;
  record.clockInTimestamp = null;
  record.clockOutTime = null;
  record.clockOutTimestamp = null;
  record.durationMinutes = null;
  record.status = 'absent';
  record.checkedInByClientId = null;
  record.checkedOutByClientId = null;
  record.isFlagged = false;
  record.flagReason = undefined;
  record.history = record.history || [];
  record.history.push({
    action: 'reset',
    timestamp: Date.now(),
    timeFormatted: formatTime(new Date()),
    clientId: 'admin',
  });

  broadcast('record_updated', record);

  res.json({ success: true, record });
}));

// Manual time adjustment (admin override)
app.post('/api/adjust-time', route((req, res) => {
  const { studentId, date, clockInTime, clockOutTime, isFlagged } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found' });
  }

  if (clockInTime !== undefined) record.clockInTime = clockInTime || null;
  if (clockOutTime !== undefined) record.clockOutTime = clockOutTime || null;
  if (isFlagged !== undefined) record.isFlagged = isFlagged;

  if (record.clockInTime && record.clockOutTime) {
    record.status = 'completed';
  } else if (record.clockInTime) {
    record.status = 'checked_in';
  } else {
    record.status = 'absent';
  }

  broadcast('record_updated', record);
  res.json({ success: true, record });
}));

// Security Alerts endpoints
app.get('/api/alerts', route((_req, res) => {
  res.json({ alerts: store.alerts });
}));

app.post('/api/alerts/acknowledge', route((req, res) => {
  const { alertId } = req.body;
  const alert = store.alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    broadcast('alerts_updated', store.alerts);
  }
  res.json({ success: true, alerts: store.alerts });
}));

app.post('/api/alerts/clear', route((_req, res) => {
  store.alerts = [];
  broadcast('alerts_updated', store.alerts);
  res.json({ success: true, alerts: [] });
}));

// CSV Export endpoint
app.get('/api/export-csv', route((req, res) => {
  const dateStr = (req.query.date as string) || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);
  const records = Object.values(dayRecords);

  let csv = 'Student Name,Status,Clock In Time,Clock Out Time,Duration,Flagged,Flag Reason,Date\n';
  for (const rec of records) {
    const nameFormatted = `"${rec.studentName.replace(/"/g, '""')}"`;
    const statusFormatted = rec.status === 'completed' ? 'Completed' : rec.status === 'checked_in' ? 'Present (Active)' : 'Absent';
    const inTime = rec.clockInTime || '--';
    const outTime = rec.clockOutTime || '--';
    const duration = rec.durationMinutes ? `${Math.floor(rec.durationMinutes / 60)}h ${rec.durationMinutes % 60}m` : '--';
    const flagged = rec.isFlagged ? 'YES' : 'No';
    const reason = rec.flagReason ? `"${rec.flagReason.replace(/"/g, '""')}"` : '""';

    csv += `${nameFormatted},${statusFormatted},${inTime},${outTime},${duration},${flagged},${reason},${dateStr}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="club_attendance_${dateStr}.csv"`);
  res.send(csv);
}));

// -------------------------------------------------------------
// Vite Server Integration
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Club Attendance Tracker server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => { console.error('Server startup failed:', error); database.close(); process.exitCode = 1; });
