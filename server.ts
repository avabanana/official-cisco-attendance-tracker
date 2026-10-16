import express from 'express';
import fs from 'node:fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { FirestorePersistence, LocalPersistence, firebaseDatabase, type Persistence } from './server/persistence.ts';
import { checkIn, checkOut, history as appendHistory } from './server/attendance.ts';
import { type StoreData } from './storage.ts';
import { CLUB_ROSTER } from './src/data/roster.ts';
import {
  AttendanceRecord,
  SecurityAlert,
  SecuritySettings,
  ClubGoalSettings,
  LaptopImageLog,
  Student,
  ImagingLeaderboardEntry,
} from './src/types.ts';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PACIFIC_TIMEZONE = 'America/Los_Angeles';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const storageMode = process.env.ATTENDANCE_STORAGE || 'firestore';
if (storageMode !== 'firestore' && storageMode !== 'sqlite') throw new Error('Invalid ATTENDANCE_STORAGE');
if (process.env.K_SERVICE && storageMode !== 'firestore') throw new Error('Cloud Run requires Firestore; refusing ephemeral SQLite storage');

app.use(express.json());

// -------------------------------------------------------------
// Firestore is authoritative. SQLite is an explicitly selected local/test backend only.
// No legacy import, seed data, backup merge, or attendance writes run at startup.
const database: Persistence = storageMode === 'firestore'
  ? new FirestorePersistence(firebaseDatabase())
  : new LocalPersistence(process.env.ATTENDANCE_DB_PATH || path.join(process.cwd(), 'data', 'attendance.sqlite'));
const requestStorage = new AsyncLocalStorage<{ store: StoreData; events: Array<[string, any]>; afterCommit: Array<() => void> }>();
function state(): StoreData {
  const context = requestStorage.getStore();
  if (!context) throw new Error('Attendance operation outside transaction');
  return context.store;
}
const allDatePaths = new Set(['/api/laptops/summary', '/api/laptops/update', '/api/store-dump', '/api/reset-all-data', '/api/firebase/backup-now', '/api/firebase/status']);
const publicWrites = new Set(['/api/checkin', '/api/checkout', '/api/admin/verify', '/api/admin/logout']);
function route(handler: express.RequestHandler): express.RequestHandler {
  return async (req, res, next) => {
    const date = req.body?.date ?? req.query.date ?? getTodayDateString();
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) {
      res.status(400).json({ error: 'Invalid attendance date' }); return;
    }
    try {
      const committed = await database.transaction(allDatePaths.has(req.path) ? null : date, current => {
        const context = { store: current, events: [] as Array<[string, any]>, afterCommit: [] as Array<() => void> };
        return requestStorage.run(context, () => {
          let response: { kind: 'json' | 'send'; body: any } | undefined;
          let status = 200;
          const headers: Record<string, string> = {};
          const buffered = new Proxy(res, {
            get(target, property) {
              if (property === 'json' || property === 'send') return (body: any) => { response = { kind: property, body: structuredClone(body) }; return buffered; };
              if (property === 'status') return (code: number) => { status = code; return buffered; };
              if (property === 'setHeader') return (key: string, value: string) => { headers[key] = value; return buffered; };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          const adminRequired = (req.method === 'POST' && !publicWrites.has(req.path)) || ['/api/store-dump','/api/email/status'].includes(req.path);
          if (adminRequired && !checkAdminAuth(req)) {
            buffered.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
          } else {
            handler(req, buffered, next);
          }
          return { response, status, headers, events: context.events, afterCommit: context.afterCommit };
        });
      }, req.method !== 'GET' && req.path !== '/api/firebase/backup-now');
      // Transaction callbacks may retry. Emit only the committed attempt's effects.
      for (const [type, data] of committed.events) broadcast(type, data);
      for (const effect of committed.afterCommit) { try { effect(); } catch (error) { console.error('Post-commit archive failed:', error); } }
      for (const [key, value] of Object.entries(committed.headers)) res.setHeader(key, value);
      res.status(committed.status);
      if (committed.response) res[committed.response.kind](committed.response.body);
    } catch (error) {
      console.error('Attendance storage transaction failed:', error);
      res.status(503).json({ error: 'Attendance storage unavailable. No success was confirmed; reload and retry.' });
    }
  };
}

// -------------------------------------------------------------
// SSE Stream & Real-time Live Events
// -------------------------------------------------------------
const sseClients = new Set<express.Response>();

function broadcast(eventType: string, data: any) {
  const context = requestStorage.getStore();
  if (context) {
    context.events.push([eventType, structuredClone(data)]);
    return;
  }
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// -------------------------------------------------------------
// Time & Date Helpers (Pacific Time)
// -------------------------------------------------------------
function getTodayDateString(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: PACIFIC_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}

function getPacificDayOfWeek(date: Date = new Date()): number {
  const weekdayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayStr] !== undefined ? map[weekdayStr] : date.getDay();
}

function getPacificTimeParts(date: Date = new Date()): { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'second') second = parseInt(p.value, 10);
  }
  return { hour: hour % 24, minute, second };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function parseTimeString(timeStr: string): { hour: number; minute: number; second: number } | null {
  if (!timeStr) return null;
  // Matches "03:00 PM" or "15:00" or "09:00:00"
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toUpperCase();
  if (minute > 59 || second > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute, second };
}

function getPacificTimestamp(dateStr: string, timeStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const parsed = parseTimeString(timeStr);
  if (!parsed) throw new Error('Invalid attendance time; no default time may be invented');
  const hours = parsed.hour;
  const minutes = parsed.minute;
  const seconds = parsed.second;

  const guess = Date.UTC(year, month - 1, day, hours + 7, minutes, seconds);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((p) => [p.type, parseInt(p.value, 10)])
  );
  const diffMs =
    (hours - (parts.hour % 24)) * 3600000 +
    (minutes - parts.minute) * 60000 +
    (seconds - parts.second) * 1000;
  return guess + diffMs;
}

// -------------------------------------------------------------
// Roster & Store Helpers
// -------------------------------------------------------------
function getAllStudents(): Student[] {
  const custom = state()?.customStudents || [];
  const map = new Map<string, Student>();
  for (const s of CLUB_ROSTER) {
    map.set(s.id, s);
  }
  for (const s of custom) {
    map.set(s.id, s);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function initDayRecords(dateStr: string): Record<string, AttendanceRecord> {
  if (!state().recordsByDate[dateStr]) {
    state().recordsByDate[dateStr] = Object.create(null);
  }
  const dayRecords = state().recordsByDate[dateStr];

  for (const student of getAllStudents()) {
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
        laptopsImaged: 0,
        laptopLogs: [],
        history: [],
      };
    } else {
      if (typeof dayRecords[student.id].laptopsImaged !== 'number') {
        dayRecords[student.id].laptopsImaged = 0;
      }
      if (!Array.isArray(dayRecords[student.id].laptopLogs)) {
        dayRecords[student.id].laptopLogs = [];
      }
    }
  }
  return dayRecords;
}

function getStudentAllTimeLaptops(studentId: string): number {
  let total = 0;
  for (const day of Object.values(state().recordsByDate || {})) {
    if (day && day[studentId] && typeof day[studentId].laptopsImaged === 'number') {
      total += day[studentId].laptopsImaged;
    }
  }
  return total;
}

function getTotalClubLaptopsAllTime(): number {
  let total = 0;
  for (const day of Object.values(state().recordsByDate || {})) {
    if (day) {
      for (const rec of Object.values(day)) {
        if (typeof rec.laptopsImaged === 'number') {
          total += rec.laptopsImaged;
        }
      }
    }
  }
  return total;
}

function getSessionTotalLaptops(dateStr: string): number {
  const day = state().recordsByDate[dateStr];
  if (!day) return 0;
  let total = 0;
  for (const rec of Object.values(day)) {
    if (typeof rec.laptopsImaged === 'number') {
      total += rec.laptopsImaged;
    }
  }
  return total;
}

function getStudentAllTimeMinutes(studentId: string): number {
  let totalMinutes = 0;
  for (const day of Object.values(state().recordsByDate || {})) {
    if (day && day[studentId]) {
      const rec = day[studentId];
      if (typeof rec.durationMinutes === 'number' && rec.durationMinutes > 0) {
        totalMinutes += rec.durationMinutes;
      }
    }
  }
  return totalMinutes;
}

function getStudentSessionsAttendedCount(studentId: string): number {
  let count = 0;
  for (const day of Object.values(state().recordsByDate || {})) {
    if (day && day[studentId]) {
      const rec = day[studentId];
      if (rec.clockInTime || (typeof rec.durationMinutes === 'number' && rec.durationMinutes > 0)) {
        count += 1;
      }
    }
  }
  return count;
}

function getTotalClubMinutesAllTime(): number {
  let total = 0;
  for (const day of Object.values(state().recordsByDate || {})) {
    if (day) {
      for (const rec of Object.values(day)) {
        if (typeof rec.durationMinutes === 'number' && rec.durationMinutes > 0) {
          total += rec.durationMinutes;
        }
      }
    }
  }
  return total;
}

// -------------------------------------------------------------
// Admin Token Authentication
// -------------------------------------------------------------
function tokenHash(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
function passwordMatches(password: unknown): boolean {
  return !!ADMIN_PASSWORD && typeof password === 'string' && crypto.timingSafeEqual(Buffer.from(tokenHash(password)), Buffer.from(tokenHash(ADMIN_PASSWORD)));
}
function generateAdminToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = state().adminSessions ||= {};
  for (const [id, expiry] of Object.entries(sessions)) if (expiry <= Date.now()) delete sessions[id];
  for (const [id] of Object.entries(sessions).sort((a,b)=>a[1]-b[1]).slice(0, Math.max(0,Object.keys(sessions).length-49))) delete sessions[id];
  sessions[tokenHash(token)] = Date.now() + 8 * 3600_000;
  return token;
}
function checkAdminAuth(req: express.Request): boolean {
  const token = req.headers['x-admin-token'];
  return passwordMatches(req.headers['x-admin-password']) ||
    (typeof token === 'string' && (state().adminSessions?.[tokenHash(token)] || 0) > Date.now());
}

// -------------------------------------------------------------
// Completed Daily Spreadsheet & Email Dispatch System
// -------------------------------------------------------------
export interface EmailDispatchLog {
  id: string;
  timestamp: number;
  dateStr: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'scheduled' | 'failed';
  method: string;
  message: string;
  csvFileName: string;
  recordCount: number;
  activeCount: number;
  totalHours: string;
  totalLaptops: number;
}

function generateDayCsvContent(dateStr: string): string {
  initDayRecords(dateStr);
  const day = state().recordsByDate[dateStr] || {};
  const students = getAllStudents();

  const headers = [
    'Student Name',
    'Status',
    'Clock In Time',
    'Clock Out Time',
    'Duration',
    'Laptops Imaged (Session)',
    'Flagged',
    'Flag Reason',
    'Date',
  ];

  const rows = students.map((s) => {
    const rec = day[s.id] || {
      studentName: s.name,
      status: 'absent',
      clockInTime: '',
      clockOutTime: '',
      durationMinutes: null,
      laptopsImaged: 0,
      isFlagged: false,
      flagReason: '',
    };

    const statusDisplay =
      rec.status === 'completed'
        ? 'Completed'
        : rec.status === 'checked_in'
        ? 'Present (Active)'
        : 'Absent';
    const clockIn = rec.clockInTime || '--';
    const clockOut = rec.clockOutTime || '--';
    const durationDisplay =
      rec.durationMinutes !== null && rec.durationMinutes !== undefined
        ? `${Math.floor(rec.durationMinutes / 60)}h ${rec.durationMinutes % 60}m`
        : '--';
    const laptops = rec.laptopsImaged || 0;
    const flagged = rec.isFlagged ? 'YES' : 'No';
    const reason = rec.flagReason ? `"${rec.flagReason.replace(/"/g, '""')}"` : '""';

    return [
      `"${rec.studentName.replace(/"/g, '""')}"`,
      `"${statusDisplay}"`,
      `${clockIn}`,
      `${clockOut}`,
      `"${durationDisplay}"`,
      laptops,
      `"${flagged}"`,
      reason,
      `"${dateStr}"`,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function dispatchCompletedSpreadsheetEmail(dateStr: string, triggerMethod: string = 'manual'): EmailDispatchLog {
  const csvContent = generateDayCsvContent(dateStr);
  const day = state().recordsByDate[dateStr] || {};
  const activeRecords = Object.values(day).filter(
    (r) => r.clockInTime || (r.laptopsImaged && r.laptopsImaged > 0)
  );
  const completedRecords = Object.values(day).filter((r) => r.status === 'completed');
  const totalMinutes = activeRecords.reduce((acc, r) => acc + (r.durationMinutes || 0), 0);
  const totalLaptops = activeRecords.reduce((acc, r) => acc + (r.laptopsImaged || 0), 0);
  const totalHoursStr = `${(totalMinutes / 60).toFixed(2)} hrs`;

  const recipient = 'avasophianorgaard@gmail.com';
  const subject = `Completed Club Attendance & Laptop Spreadsheet - ${dateStr}`;
  const now = Date.now();

  const logEntry: EmailDispatchLog = {
    id: `email-${now}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now,
    dateStr,
    recipient,
    subject,
    status: 'scheduled',
    method: triggerMethod,
    message: `Spreadsheet generated for ${recipient}; email delivery is not configured (${activeRecords.length} volunteers attended, ${completedRecords.length} clocked out completed, ${totalHoursStr} hours, ${totalLaptops} laptops imaged).`,
    csvFileName: `club_attendance_and_laptops_${dateStr}.csv`,
    recordCount: Object.keys(day).length,
    activeCount: activeRecords.length,
    totalHours: totalHoursStr,
    totalLaptops,
  };

  state().emailLogs = state().emailLogs || [];
  state().emailLogs.unshift(logEntry);
  if (state().emailLogs.length > 50) state().emailLogs.pop();

  requestStorage.getStore()!.afterCommit.push(() => {
  // Archive email dispatch file on disk
  try {
    const emailsDir = path.join(process.cwd(), 'data', 'archives', 'emails');
    if (!fs.existsSync(emailsDir)) fs.mkdirSync(emailsDir, { recursive: true });
    const emailFile = path.join(emailsDir, `${dateStr}-email-dispatch.json`);
    fs.writeFileSync(
      emailFile,
      JSON.stringify(
        {
          ...logEntry,
          dispatchedAt: new Date(now).toISOString(),
          csvPreview: csvContent.slice(0, 1500),
          csvLength: csvContent.length,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch (err) {
    console.warn('Could not archive email dispatch:', err);
  }

  // Also save CSV to sheets/ directory
  try {
    const sheetsDir = path.join(process.cwd(), 'data', 'archives', 'sheets');
    if (!fs.existsSync(sheetsDir)) fs.mkdirSync(sheetsDir, { recursive: true });
    fs.writeFileSync(path.join(sheetsDir, `${dateStr}.csv`), csvContent, 'utf-8');
  } catch {}

  });
  broadcast('email_dispatched', logEntry);
  console.log(
    `[SPREADSHEET EXPORT] Generated spreadsheet for ${recipient} for ${dateStr} (${activeRecords.length} active, ${totalLaptops} laptops, method: ${triggerMethod})`
  );
  return logEntry;
}

// Automated 5:00 PM Pacific check for weekdays (Mon, Tue, Thu, Fri - Wed excluded)
// Email delivery requires a configured transport; no timer mutates attendance or archives.


// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

// SSE stream for real-time live events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`event: connected\ndata: {"status":"connected"}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Admin Authentication endpoints
app.post('/api/admin/verify', route((req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin password is not configured on the server' });
  if (!passwordMatches(req.body.password)) return res.status(401).json({ error: 'Incorrect admin password. Access denied.' });
  res.json({ success: true, token: generateAdminToken() });
}));
app.post('/api/admin/logout', route((req, res) => {
  const token = req.headers['x-admin-token'];
  if (typeof token === 'string') delete state().adminSessions?.[tokenHash(token)];
  res.json({ success: true });
}));
app.get('/api/roster', route((_req, res) => { res.json({ roster: getAllStudents() }); }));

// Add new student volunteer to the roster
app.post('/api/roster/add', route((req, res) => {
  const { firstName, lastName, clockInNow, date } = req.body;
  if (clockInNow !== undefined && typeof clockInNow !== 'boolean') return res.status(400).json({ error: 'clockInNow must be an explicit boolean' });
  const trimmedFirst = typeof firstName === 'string' ? firstName.trim() : '';
  const trimmedLast = typeof lastName === 'string' ? lastName.trim() : '';

  if (!trimmedFirst && !trimmedLast) {
    return res.status(400).json({ error: 'Please enter a name for the volunteer.' });
  }

  const formattedName =
    trimmedLast && trimmedFirst
      ? `${trimmedLast}, ${trimmedFirst}`
      : trimmedLast || trimmedFirst;

  const allStudents = getAllStudents();
  if (allStudents.some((s) => s.name.toLowerCase() === formattedName.toLowerCase())) {
    return res.status(400).json({ error: `Volunteer "${formattedName}" already exists in the roster.` });
  }

  let baseId = `${trimmedLast || ''}-${trimmedFirst || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!baseId) {
    baseId = `volunteer-${Date.now()}`;
  }

  let uniqueId = baseId;
  let counter = 2;
  while (allStudents.some((s) => s.id === uniqueId)) {
    uniqueId = `${baseId}-${counter}`;
    counter++;
  }

  const newStudent: Student = {
    id: uniqueId,
    name: formattedName,
    lastName: trimmedLast,
    firstName: trimmedFirst,
  };

  state().customStudents = state().customStudents || [];
  state().customStudents.push(newStudent);

  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  if (clockInNow === true && dayRecords[newStudent.id]) {
    const now = Date.now();
    const formatted = formatTime(new Date(now));
    const rec = dayRecords[newStudent.id];
    rec.clockInTime = formatted;
    rec.clockInTimestamp = now;
    rec.status = 'checked_in';
    rec.checkedInByClientId = 'admin_panel';
    rec.history = rec.history || [];
    rec.history.push({
      action: 'check_in',
      timestamp: now,
      timeFormatted: formatted,
      clientId: 'admin_panel',
    });

    broadcast('record_updated', rec);
  }

  const updatedRoster = getAllStudents();
  broadcast('roster_updated', { roster: updatedRoster, newStudent });

  res.json({
    success: true,
    student: newStudent,
    roster: updatedRoster,
  });
}));

// Settings
app.get('/api/settings', route((_req, res) => {
  res.json(state().settings);
}));

app.post('/api/settings', route((req, res) => {
  const allowed = ['rapidThresholdSeconds','strictMode','soundAlerts','kioskMode'];
  for (const [key,value] of Object.entries(req.body)) {
    if (!allowed.includes(key) || (key === 'rapidThresholdSeconds' ? typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3600 : typeof value !== 'boolean')) return res.status(400).json({ error: 'Invalid security setting' });
  }
  state().settings = { ...state().settings, ...req.body };
  broadcast('settings_updated', state().settings);
  res.json(state().settings);
}));

// Attendance for specific date
app.get('/api/attendance', route((req, res) => {
  const dateStr = (req.query.date as string) || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);
  const recordsList = Object.values(dayRecords);
  res.json({ date: dateStr, records: recordsList });
}));

// Check-in endpoint
app.post('/api/checkin', route((req, res) => {
  const { studentId, date, clientId, isAdminOverride } = req.body;
  if (req.body.intent !== 'manual') return res.status(400).json({ error: 'An explicit manual attendance action is required' });
  const authorizedAdmin = checkAdminAuth(req);
  if (isAdminOverride && !authorizedAdmin) return res.status(401).json({ error: 'Admin override requires authentication' });
  if (!authorizedAdmin && (!clientId || typeof clientId !== 'string' || clientId.length > 128)) return res.status(400).json({ error: 'A device ID is required' });
  if (!authorizedAdmin && date && date !== getTodayDateString()) return res.status(403).json({ error: 'Only an admin may change historical attendance' });

  if (!authorizedAdmin && getPacificTimeParts().hour < 15) return res.status(403).json({ error: 'Check-in opens at 3:00 PM Pacific', restrictedBefore3PM: true });
  const dateStr = date || getTodayDateString();
  const bindingKey = `${dateStr}:${clientId}`;
  const bound = state().deviceBindings?.[bindingKey];
  if (!authorizedAdmin && bound && bound !== studentId) return res.status(403).json({ error: 'This device is already assigned to another student today. Ask an admin for help.', deviceReuseBlocked: true });
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  if (record.status === 'checked_in') return res.json({ success: true, record, alert: null });
  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);
  const clientKey = authorizedAdmin && isAdminOverride ? 'admin_panel' : clientId;
  const previousClick = state().recentClicks[clientKey];

  let flagReason = '';
  let generatedAlert: SecurityAlert | null = null;

  if (!isAdminOverride && previousClick && previousClick.studentId !== studentId) {
    const diffSeconds = Math.round((now - previousClick.timestamp) / 1000);

    if (diffSeconds <= state().settings.rapidThresholdSeconds) {
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

      state().alerts.unshift(generatedAlert);
      if (state().alerts.length > 200) state().alerts.pop();

      if (state().settings.strictMode && !isAdminOverride) {
        broadcast('security_alert', generatedAlert);
        return res.status(403).json({
          error: `Multiple student check-in prohibited! Only one student may check in per device within ${state().settings.rapidThresholdSeconds}s. An alert has been sent to the club administrator.`,
          flagged: true,
          alert: generatedAlert,
        });
      }
    }
  }

  const oldestDate = new Date(now - 2 * 86400000).toISOString().slice(0,10);
  for (const key of Object.keys(state().deviceBindings || {})) if (key.slice(0,10) < oldestDate) delete state().deviceBindings![key];
  for (const [key, value] of Object.entries(state().recentClicks)) if (now - value.timestamp > Math.max(60, state().settings.rapidThresholdSeconds || 20) * 1000) delete state().recentClicks[key];
  checkIn(record, now, clientKey);
  if (flagReason) { record.isFlagged = true; record.flagReason = flagReason; }
  if (!authorizedAdmin) (state().deviceBindings ||= {})[bindingKey] = studentId;

  state().recentClicks[clientKey] = {
    studentId,
    studentName: record.studentName,
    timestamp: now,
  };

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
  const { studentId, date, clientId, isAdminOverride } = req.body;
  if (req.body.intent !== 'manual') return res.status(400).json({ error: 'An explicit manual attendance action is required' });
  const authorizedAdmin = checkAdminAuth(req);
  if (isAdminOverride && !authorizedAdmin) return res.status(401).json({ error: 'Admin override requires authentication' });
  if (!authorizedAdmin && (!clientId || typeof clientId !== 'string' || clientId.length > 128)) return res.status(400).json({ error: 'A device ID is required' });
  if (!authorizedAdmin && date && date !== getTodayDateString()) return res.status(403).json({ error: 'Only an admin may change historical attendance' });

  const dateStr = date || getTodayDateString();
  const bound = state().deviceBindings?.[`${dateStr}:${clientId}`];
  if (!authorizedAdmin && bound && bound !== studentId) return res.status(403).json({ error: 'This device belongs to another student today', deviceReuseBlocked: true });
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  if (record.status === 'completed') return res.json({ success: true, record });
  if (!record.clockInTimestamp && !record.clockInTime) {
    return res.status(400).json({ error: 'Student must check in before checking out' });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);
  const clientKey = clientId || req.ip || 'unknown-client';

  if (!record.clockInTimestamp && record.clockInTime) record.clockInTimestamp = getPacificTimestamp(dateStr, record.clockInTime);
  checkOut(record, now, authorizedAdmin && isAdminOverride ? 'admin_panel' : clientKey);
  if (!authorizedAdmin) (state().deviceBindings ||= {})[`${dateStr}:${clientId}`] = studentId;
  if (record.post415Exceeded) {
    const alert: SecurityAlert = { id: `late-${now}-${studentId}`, timestamp: now, date: dateStr, timeFormatted: formattedTime,
      type: record.cutoffExceeded ? 'LATE_CHECKOUT' : 'POST_415_CHECKOUT', severity: record.cutoffExceeded ? 'critical' : 'warning',
      currentStudent: record.studentName, studentId, attemptedTime: formattedTime, clientId: clientKey,
      message: record.cutoffExceeded ? 'Checkout capped at 4:45 PM Pacific; admin review required' : 'Checkout after 4:15 PM Pacific', acknowledged: false };
    state().alerts.unshift(alert); state().alerts = state().alerts.slice(0,200); broadcast('security_alert', alert);
  }

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

  record.completedSessionMinutes = 0;
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

// Manual time & laptop adjustment (admin override)
app.post('/api/adjust-time', route((req, res) => {
  const { studentId, date, clockInTime, clockOutTime, isFlagged, laptopsImaged } = req.body;
  for (const value of [clockInTime, clockOutTime]) {
    if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !parseTimeString(value))) return res.status(400).json({ error: 'Invalid attendance time' });
  }
  if ((isFlagged !== undefined && typeof isFlagged !== 'boolean') || (laptopsImaged !== undefined && (!Number.isSafeInteger(laptopsImaged) || laptopsImaged < 0 || laptopsImaged > 500))) return res.status(400).json({ error: 'Invalid record adjustment' });

  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const nextIn = clockInTime !== undefined ? clockInTime : record.clockInTime;
  const nextOut = clockOutTime !== undefined ? clockOutTime : record.clockOutTime;
  if (nextOut && !nextIn) return res.status(400).json({ error: 'Checkout requires an arrival time' });
  if (nextIn && nextOut && getPacificTimestamp(dateStr, nextOut) < getPacificTimestamp(dateStr, nextIn)) return res.status(400).json({ error: 'Checkout cannot precede arrival' });
  record.completedSessionMinutes = 0;
  appendHistory(record, 'admin_edit', Date.now(), 'admin_panel');
  if (clockInTime !== undefined) record.clockInTime = clockInTime || null;
  if (clockOutTime !== undefined) record.clockOutTime = clockOutTime || null;
  if (isFlagged !== undefined) record.isFlagged = isFlagged;
  if (typeof laptopsImaged === 'number') {
    record.laptopsImaged = Math.max(0, laptopsImaged);
  }

  if (record.clockInTime && record.clockOutTime) {
    record.status = 'completed';
    const clockInTs = getPacificTimestamp(dateStr, record.clockInTime);
    const clockOutTs = getPacificTimestamp(dateStr, record.clockOutTime);
    record.clockInTimestamp = clockInTs;
    record.clockOutTimestamp = clockOutTs;
    record.durationMinutes = Math.max(0, Math.round((clockOutTs - clockInTs) / 60000));
  } else if (record.clockInTime) {
    record.status = 'checked_in';
    record.clockInTimestamp = getPacificTimestamp(dateStr, record.clockInTime);
    record.clockOutTimestamp = null;
    record.durationMinutes = null;
  } else {
    record.status = 'absent';
    record.clockInTimestamp = null;
    record.clockOutTimestamp = null;
    record.durationMinutes = null;
  }

  broadcast('record_updated', record);
  res.json({ success: true, record });
}));

app.post('/api/approve-exception', route((req, res) => {
  const date = req.body.date || getTodayDateString();
  const record = initDayRecords(date)[req.body.studentId];
  const approvedTime = req.body.actualTime;
  if (!record) return res.status(404).json({ error: 'Student not found' });
  if (typeof approvedTime !== 'string' || !parseTimeString(approvedTime) || !record.clockInTimestamp) return res.status(400).json({ error: 'Valid checkout and existing arrival required' });
  const timestamp = getPacificTimestamp(date, approvedTime);
  if (timestamp < record.clockInTimestamp) return res.status(400).json({ error: 'Checkout cannot precede arrival' });
  record.clockOutTime = approvedTime; record.clockOutTimestamp = timestamp;
  record.durationMinutes = (record.completedSessionMinutes || 0) + Math.round((timestamp - record.clockInTimestamp) / 60000);
  record.status = 'completed'; record.exceptionGranted = true; record.exceptionApprovedTime = approvedTime;
  record.exceptionNote = String(req.body.notes || '').slice(0,500);
  appendHistory(record, 'exception_grant', Date.now(), 'admin_panel');
  broadcast('record_updated', record); res.json({ success: true, record });
}));

// Reset all attendance and laptop records across a specific date
app.post('/api/reset-day', route((req, res) => {
  const { date } = req.body;
  const dateStr = date || getTodayDateString();

  const newDayRecords: Record<string, AttendanceRecord> = Object.create(null);
  for (const student of getAllStudents()) {
    newDayRecords[student.id] = {
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
      laptopsImaged: 0,
      laptopLogs: [],
      history: [],
    };

  }

  state().recordsByDate[dateStr] = newDayRecords;
  broadcast('day_reset', { date: dateStr, records: Object.values(newDayRecords) });
  res.json({
    success: true,
    message: `All records for ${dateStr} reset`,
    records: Object.values(newDayRecords),
  });
}));

// Completely reset all site data
app.post('/api/reset-all-data', route((req, res) => {
  const todayStr = getTodayDateString();
  const freshDayRecords: Record<string, AttendanceRecord> = Object.create(null);
  for (const student of getAllStudents()) {
    freshDayRecords[student.id] = {
      id: `${todayStr}_${student.id}`,
      date: todayStr,
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
      laptopsImaged: 0,
      laptopLogs: [],
      history: [],
    };

  }

  state().activeGeneration = crypto.randomUUID();
  state().recordsByDate = { [todayStr]: freshDayRecords };
  state().alerts = [];
  state().hasBeenReset = true;

  broadcast('day_reset', { date: todayStr, records: Object.values(freshDayRecords) });
  broadcast('alerts_updated', []);
  broadcast('all_data_reset', { date: todayStr, records: Object.values(freshDayRecords) });

  res.json({
    success: true,
    message: 'All site data reset.',
    date: todayStr,
    records: Object.values(freshDayRecords),
  });
}));

// Laptop imaging update
app.post('/api/laptops/update', route((req, res) => {
  const { studentId, date, delta, setCount, log, clientId } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  const prevCount = record.laptopsImaged || 0;
  let newCount = prevCount;

  if (typeof setCount === 'number') {
    newCount = Math.max(0, setCount);
  } else if (typeof delta === 'number') {
    newCount = Math.max(0, prevCount + delta);
  }

  if (!Number.isSafeInteger(newCount) || newCount > 500) return res.status(400).json({ error: 'Laptop count must be an integer between 0 and 500' });
  record.laptopsImaged = newCount;
  appendHistory(record, 'laptop_update', Date.now(), 'admin_panel');
  const now = Date.now();
  const formattedTime = formatTime(new Date(now));
  const clientKey = clientId || req.ip || 'terminal';

  record.laptopLogs = record.laptopLogs || [];
  if (log) {
    record.laptopLogs.push({
      id: `log-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      timeFormatted: formattedTime,
      count: log.count || (delta && delta > 0 ? delta : 1),
      model: log.model || 'Standard Club Laptop',
      assetTag: log.assetTag || '',
      notes: log.notes || '',
    });
  } else if (delta && delta > 0) {
    record.laptopLogs.push({
      id: `log-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      timeFormatted: formattedTime,
      count: delta,
      model: 'Club Laptop',
      assetTag: '',
      notes: 'Quick logged in session',
    });
  }

  broadcast('record_updated', record);
  res.json({
    success: true,
    record,
    allTimeLaptops: getStudentAllTimeLaptops(studentId),
    sessionTotal: getSessionTotalLaptops(dateStr),
    allTimeTotal: getTotalClubLaptopsAllTime(),
  });
}));

// Laptop Progress & Leaderboard Summary
app.get('/api/laptops/summary', route((req, res) => {
  const dateStr = (req.query.date as string) || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const sessionTotal = getSessionTotalLaptops(dateStr);
  const allTimeTotal = getTotalClubLaptopsAllTime();
  const allCurrentStudents = getAllStudents();

  const sessionLeaderboard: ImagingLeaderboardEntry[] = allCurrentStudents
    .map((student) => {
      const rec = dayRecords[student.id];
      return {
        studentId: student.id,
        studentName: student.name,
        lastName: student.lastName,
        firstName: student.firstName,
        sessionLaptops: rec?.laptopsImaged || 0,
        allTimeLaptops: getStudentAllTimeLaptops(student.id),
        status: rec?.status || 'absent',
        clockInTime: rec?.clockInTime || null,
        durationMinutes: rec?.durationMinutes || null,
        rank: 0,
      };
    })
    .sort((a, b) => b.sessionLaptops - a.sessionLaptops || b.allTimeLaptops - a.allTimeLaptops);

  sessionLeaderboard.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  const allTimeLeaderboard: ImagingLeaderboardEntry[] = allCurrentStudents
    .map((student) => {
      const rec = dayRecords[student.id];
      return {
        studentId: student.id,
        studentName: student.name,
        lastName: student.lastName,
        firstName: student.firstName,
        sessionLaptops: rec?.laptopsImaged || 0,
        allTimeLaptops: getStudentAllTimeLaptops(student.id),
        status: rec?.status || 'absent',
        clockInTime: rec?.clockInTime || null,
        durationMinutes: rec?.durationMinutes || null,
        rank: 0,
      };
    })
    .sort((a, b) => b.allTimeLaptops - a.allTimeLaptops || b.sessionLaptops - a.sessionLaptops);

  allTimeLeaderboard.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  const allTimeHoursMap: Record<string, number> = {};
  const allTimeSessionsMap: Record<string, number> = {};

  for (const student of allCurrentStudents) {
    allTimeHoursMap[student.id] = getStudentAllTimeMinutes(student.id);
    allTimeSessionsMap[student.id] = getStudentSessionsAttendedCount(student.id);
  }

  for (const entry of sessionLeaderboard) {
    const mins = allTimeHoursMap[entry.studentId] || 0;
    entry.allTimeMinutes = mins;
    entry.allTimeHoursFormatted = mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '0h 0m';
    entry.allTimeHoursDecimal = parseFloat((mins / 60).toFixed(2));
    entry.sessionsAttended = allTimeSessionsMap[entry.studentId] || 0;
  }

  for (const entry of allTimeLeaderboard) {
    const mins = allTimeHoursMap[entry.studentId] || 0;
    entry.allTimeMinutes = mins;
    entry.allTimeHoursFormatted = mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '0h 0m';
    entry.allTimeHoursDecimal = parseFloat((mins / 60).toFixed(2));
    entry.sessionsAttended = allTimeSessionsMap[entry.studentId] || 0;
  }

  const allTimeHoursLeaderboard = allCurrentStudents
    .map((student) => {
      const rec = dayRecords[student.id];
      const mins = allTimeHoursMap[student.id] || 0;
      return {
        studentId: student.id,
        studentName: student.name,
        lastName: student.lastName,
        firstName: student.firstName,
        sessionLaptops: rec?.laptopsImaged || 0,
        allTimeLaptops: getStudentAllTimeLaptops(student.id),
        allTimeMinutes: mins,
        allTimeHoursFormatted: mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '0h 0m',
        allTimeHoursDecimal: parseFloat((mins / 60).toFixed(2)),
        sessionsAttended: allTimeSessionsMap[student.id] || 0,
        status: rec?.status || 'absent',
        clockInTime: rec?.clockInTime || null,
        durationMinutes: rec?.durationMinutes || null,
        rank: 0,
      };
    })
    .sort((a, b) => b.allTimeMinutes - a.allTimeMinutes || b.allTimeLaptops - a.allTimeLaptops);

  allTimeHoursLeaderboard.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  res.json({
    date: dateStr,
    sessionTotal,
    allTimeTotal,
    allTimeTotalClubMinutes: getTotalClubMinutesAllTime(),
    allTimeTotalClubHours: parseFloat((getTotalClubMinutesAllTime() / 60).toFixed(1)),
    clubGoal: state().clubGoal || { targetLaptops: 2500, sessionTarget: 50 },
    activeImagersSessionCount: sessionLeaderboard.filter((s) => s.sessionLaptops > 0).length,
    totalMembersCount: allCurrentStudents.length,
    sessionLeaderboard,
    allTimeLeaderboard,
    allTimeHoursLeaderboard,
    allTimeHoursMap,
    allTimeSessionsMap,
  });
}));

// Laptop Goal
app.post('/api/laptops/goal', route((req, res) => {
  const { targetLaptops, sessionTarget } = req.body;
  state().clubGoal = state().clubGoal || { targetLaptops: 2500, sessionTarget: 50 };
  if (typeof targetLaptops === 'number') state().clubGoal.targetLaptops = Math.max(1, targetLaptops);
  if (typeof sessionTarget === 'number') state().clubGoal.sessionTarget = Math.max(1, sessionTarget);
  broadcast('goal_updated', state().clubGoal);
  res.json({ success: true, clubGoal: state().clubGoal });
}));

// Security Alerts endpoints
app.get('/api/alerts', route((_req, res) => {
  res.json({ alerts: state().alerts });
}));

app.post('/api/alerts/acknowledge', route((req, res) => {
  const { alertId } = req.body;
  const alert = state().alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    broadcast('alerts_updated', state().alerts);
  }
  res.json({ success: true, alerts: state().alerts });
}));

app.post('/api/alerts/clear', route((_req, res) => {
  state().alerts = [];
  broadcast('alerts_updated', state().alerts);
  res.json({ success: true, alerts: [] });
}));

// Full CSV Export endpoint
app.get('/api/export-csv', route((req, res) => {
  const dateStr = (req.query.date as string) || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);
  const records = Object.values(dayRecords);

  let csv = 'Student Name,Status,Clock In Time,Clock Out Time,Duration,Laptops Imaged (Session),Flagged,Flag Reason,Date\n';
  for (const rec of records) {
    const nameFormatted = `"${rec.studentName.replace(/"/g, '""')}"`;
    const statusFormatted =
      rec.status === 'completed'
        ? 'Completed'
        : rec.status === 'checked_in'
        ? 'Present (Active)'
        : 'Absent';
    const inTime = rec.clockInTime || '--';
    const outTime = rec.clockOutTime || '--';
    const duration =
      rec.durationMinutes !== null && rec.durationMinutes !== undefined
        ? `${Math.floor(rec.durationMinutes / 60)}h ${rec.durationMinutes % 60}m`
        : '--';
    const laptops = rec.laptopsImaged || 0;
    const flagged = rec.isFlagged ? 'YES' : 'No';
    const reason = rec.flagReason ? `"${rec.flagReason.replace(/"/g, '""')}"` : '""';

    csv += `${nameFormatted},${statusFormatted},${inTime},${outTime},${duration},${laptops},${flagged},${reason},${dateStr}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="club_attendance_and_laptops_${dateStr}.csv"`);
  res.send(csv);
}));

// Automated 5:00 PM email schedule and dispatch history
app.get('/api/email/status', route((_req, res) => {
  const todayStr = getTodayDateString();
  const day = state().recordsByDate[todayStr] || {};
  const activeCount = Object.values(day).filter(
    (r) => r.clockInTime || (r.laptopsImaged && r.laptopsImaged > 0)
  ).length;
  const completedCount = Object.values(day).filter((r) => r.status === 'completed').length;

  res.json({
    schedule: 'Automatic email delivery is not configured. Manual spreadsheet export is available.',
    transportConfigured: false,
    recipient: 'avasophianorgaard@gmail.com',
    todayDate: todayStr,
    todayStats: {
      activeCount,
      completedCount,
      totalMembers: getAllStudents().length,
      csvAvailable: fs.existsSync(path.join(process.cwd(), 'sheets', `${todayStr}.csv`)),
    },
    logs: state().emailLogs || [],
  });
}));

// Admin endpoint to trigger sending the completed spreadsheet email immediately
app.post('/api/admin/send-email', route((req, res) => {
  const { date } = req.body;
  const targetDate = date || getTodayDateString();
  initDayRecords(targetDate);
  const logEntry = dispatchCompletedSpreadsheetEmail(targetDate, 'admin_manual_trigger');
  res.json({
    success: true,
    message: `Spreadsheet for ${targetDate} generated; email delivery is not configured`,
    log: logEntry,
  });
}));

// Store Dump for backup
app.get('/api/store-dump', route((_req, res) => {
  res.json({
    recordsByDate: state().recordsByDate,
    customStudents: state().customStudents || [],
    clubGoal: state().clubGoal,
    settings: state().settings,
    alerts: state().alerts,
    emailLogs: state().emailLogs || [],
  });
}));

// The legacy sync button is now a read-only verification. It cannot replay stale records.
app.get('/api/firebase/status', route((_req, res) => {
  const total = Object.values(state().recordsByDate).reduce((sum, day) => sum + Object.keys(day).length, 0);
  res.json({ connected: storageMode === 'firestore', storage: storageMode, authoritative: storageMode === 'firestore', totalRecordsSynced: total });
}));
app.post('/api/firebase/backup-now', route((_req, res) => {
  if (storageMode !== 'firestore') return res.status(503).json({ error: 'Firestore is not the active storage backend' });
  const total = Object.values(state().recordsByDate).reduce((sum, day) => sum + Object.keys(day).length, 0);
  res.json({ success: true, count: total, message: 'Firestore read verified. Writes are committed directly; no bulk sync was performed.', details: { backedUp: total, total } });
}));

// -------------------------------------------------------------
// Vite Server Integration & Startup
// -------------------------------------------------------------
async function startServer() {
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API route not found' }); });
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

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  void database.close();
  process.exitCode = 1;
});
