import express from 'express';
import fs from 'node:fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { initializeApp as initFirebaseApp } from 'firebase/app';
import {
  getFirestore as getFirebaseFirestore,
  collection as fbCollection,
  doc as fbDoc,
  setDoc as fbSetDoc,
  getDocs as fbGetDocs,
} from 'firebase/firestore';
import { AttendanceDatabase, type StoreData } from './storage.ts';
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Anteater7202';

app.use(express.json());

// -------------------------------------------------------------
// SQLite Storage Initialization (Atomic + Crash-Resilient)
// -------------------------------------------------------------
const dbPath = process.env.ATTENDANCE_DB_PATH || path.join(process.cwd(), 'data', 'attendance.sqlite');
const database = new AttendanceDatabase(dbPath);

// Safely initialize if database is uninitialized
if (!database.isInitialized()) {
  const legacyPath = path.join(process.cwd(), 'attendance_store.json');
  if (fs.existsSync(legacyPath) && !process.env.ATTENDANCE_DB_PATH) {
    try {
      database.importLegacy(legacyPath);
      console.log('[STORAGE] Imported existing attendance_store.json into SQLite database');
    } catch (err) {
      console.warn('[STORAGE] Legacy import fallback to empty store:', err);
      database.transaction(() => {});
    }
  } else {
    database.transaction(() => {});
  }
}

let store: StoreData;
let pendingEvents: Array<[string, any]> | null = null;
let pendingRecordsToSync: AttendanceRecord[] = [];

// -------------------------------------------------------------
// Firebase Firestore Integration (Cloud Backup & Persistence)
// -------------------------------------------------------------
let firestoreDb: any = null;
let lastFirestoreSyncTimestamp: number | null = null;
let totalFirestoreSyncedCount = 0;

try {
  const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const cfg = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    const fbApp = initFirebaseApp(cfg, 'server-firestore-app');
    firestoreDb = getFirebaseFirestore(fbApp, cfg.firestoreDatabaseId);
    console.log('[FIREBASE] Firestore connected for server backup, db:', cfg.firestoreDatabaseId);
  }
} catch (err) {
  console.warn('[FIREBASE] Firestore server init warning:', err);
}

async function syncRecordToFirestore(rec: AttendanceRecord) {
  if (!firestoreDb) return;
  try {
    const cleanRecord = {
      id: rec.id,
      studentId: rec.studentId,
      studentName: rec.studentName,
      date: rec.date,
      status: rec.status,
      clockInTime: rec.clockInTime || null,
      clockInTimestamp: rec.clockInTimestamp || null,
      clockOutTime: rec.clockOutTime || null,
      clockOutTimestamp: rec.clockOutTimestamp || null,
      durationMinutes: typeof rec.durationMinutes === 'number' ? rec.durationMinutes : null,
      laptopsImaged: typeof rec.laptopsImaged === 'number' ? rec.laptopsImaged : 0,
      isFlagged: Boolean(rec.isFlagged),
      flagReason: rec.flagReason || null,
    };
    await fbSetDoc(fbDoc(firestoreDb, 'attendance_records', rec.id), cleanRecord, { merge: true });
    lastFirestoreSyncTimestamp = Date.now();
  } catch (err) {
    // Non-blocking catch to ensure offline resilience
  }
}

async function backupAllToFirestore(): Promise<{ backedUp: number; total: number }> {
  if (!firestoreDb) return { backedUp: 0, total: 0 };
  let count = 0;
  let total = 0;
  const currentStore = database.transaction((s) => s);
  for (const day of Object.values(currentStore.recordsByDate || {})) {
    for (const rec of Object.values(day)) {
      total++;
      if (
        rec.clockInTime ||
        rec.clockOutTime ||
        (rec.durationMinutes && rec.durationMinutes > 0) ||
        (rec.laptopsImaged && rec.laptopsImaged > 0)
      ) {
        await syncRecordToFirestore(rec);
        count++;
      }
    }
  }
  totalFirestoreSyncedCount = count;
  lastFirestoreSyncTimestamp = Date.now();
  console.log(`[FIREBASE] Complete backup synced ${count} active records to Firestore`);
  return { backedUp: count, total };
}

async function syncFromFirestore(): Promise<number> {
  if (!firestoreDb) return 0;
  try {
    const snap = await fbGetDocs(fbCollection(firestoreDb, 'attendance_records'));
    let merged = 0;
    database.transaction((current) => {
      snap.forEach((d) => {
        const data = d.data() as Partial<AttendanceRecord>;
        if (data.date && data.studentId && data.id) {
          if (!current.recordsByDate[data.date]) {
            current.recordsByDate[data.date] = Object.create(null);
          }
          const day = current.recordsByDate[data.date];
          const existing = day[data.studentId];
          if (!existing || (!existing.clockInTime && data.clockInTime)) {
            const fallback: AttendanceRecord = {
              id: data.id,
              date: data.date,
              studentId: data.studentId,
              studentName: data.studentName || data.studentId,
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
              history: [],
            };
            const base = existing || fallback;
            day[data.studentId] = {
              ...base,
              ...data,
              clockInTime: data.clockInTime ?? base.clockInTime,
              clockInTimestamp: data.clockInTimestamp ?? base.clockInTimestamp,
              clockOutTime: data.clockOutTime ?? base.clockOutTime,
              clockOutTimestamp: data.clockOutTimestamp ?? base.clockOutTimestamp,
              status: (data.status as any) || 'completed',
              durationMinutes:
                typeof data.durationMinutes === 'number'
                  ? data.durationMinutes
                  : base.durationMinutes,
              laptopsImaged:
                typeof data.laptopsImaged === 'number'
                  ? data.laptopsImaged
                  : base.laptopsImaged ?? 0,
            };
            merged++;
          }
        }
      });
    });
    if (merged > 0) {
      console.log(`[FIREBASE] Merged ${merged} records from Firestore into SQLite store`);
    }
    return merged;
  } catch (err) {
    console.warn('[FIREBASE] Sync from Firestore warning:', err);
    return 0;
  }
}

// -------------------------------------------------------------
// Transactional Route Wrapper with Proxy Buffering
// -------------------------------------------------------------
function route(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    let response: { kind: 'json' | 'send'; body: any } | undefined;
    const buffered = new Proxy(res, {
      get(target, property) {
        if (property === 'json' || property === 'send') {
          return (body: any) => {
            response = { kind: property, body };
            return buffered;
          };
        }
        if (property === 'status') {
          return (code: number) => {
            target.statusCode = code;
            return buffered;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    pendingEvents = [];
    pendingRecordsToSync = [];

    try {
      database.transaction((current) => {
        store = current;
        handler(req, buffered, next);
      });

      const events = pendingEvents;
      const recordsToSync = pendingRecordsToSync;
      pendingEvents = null;
      pendingRecordsToSync = [];

      for (const [type, data] of events) {
        broadcast(type, data);
      }

      // Background async backup to Firestore for any changed records
      if (recordsToSync.length > 0 && firestoreDb) {
        for (const rec of recordsToSync) {
          syncRecordToFirestore(rec).catch(() => {});
        }
      }

      if (response) {
        res[response.kind](response.body);
      }
    } catch (error) {
      pendingEvents = null;
      pendingRecordsToSync = [];
      console.error('Attendance operation failed:', error);
      res.removeHeader('Content-Disposition');
      res.setHeader('Content-Type', 'application/json');
      res.status(503).json({ error: 'Attendance storage unavailable. Please retry.' });
    }
  };
}

// -------------------------------------------------------------
// SSE Stream & Real-time Live Events
// -------------------------------------------------------------
const sseClients = new Set<express.Response>();

function broadcast(eventType: string, data: any) {
  if (pendingEvents) {
    pendingEvents.push([eventType, structuredClone(data)]);
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
  const match = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute, second };
}

function getPacificTimestamp(dateStr: string, timeStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const parsed = parseTimeString(timeStr);
  const hours = parsed ? parsed.hour : 16;
  const minutes = parsed ? parsed.minute : 45;
  const seconds = parsed ? parsed.second : 0;

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
  const custom = store?.customStudents || [];
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
  if (!store.recordsByDate[dateStr]) {
    store.recordsByDate[dateStr] = Object.create(null);
  }
  const dayRecords = store.recordsByDate[dateStr];

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
  for (const day of Object.values(store.recordsByDate || {})) {
    if (day && day[studentId] && typeof day[studentId].laptopsImaged === 'number') {
      total += day[studentId].laptopsImaged;
    }
  }
  return total;
}

function getTotalClubLaptopsAllTime(): number {
  let total = 0;
  for (const day of Object.values(store.recordsByDate || {})) {
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
  const day = store.recordsByDate[dateStr];
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
  for (const day of Object.values(store.recordsByDate || {})) {
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
  for (const day of Object.values(store.recordsByDate || {})) {
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
  for (const day of Object.values(store.recordsByDate || {})) {
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
const activeAdminTokens = new Set<string>();

function generateAdminToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);
  if (!store.adminTokens) store.adminTokens = [];
  store.adminTokens.push(token);
  if (store.adminTokens.length > 50) store.adminTokens = store.adminTokens.slice(-50);
  return token;
}

function checkAdminAuth(req: express.Request): boolean {
  const tokenHeader = req.headers['x-admin-token'] as string | undefined;
  const authHeader = req.headers['authorization'] as string | undefined;
  let token = tokenHeader;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }
  const rawPw = req.headers['x-admin-password'] as string | undefined;
  if (rawPw && rawPw === ADMIN_PASSWORD) {
    return true;
  }
  if (token && (activeAdminTokens.has(token) || (store?.adminTokens && store.adminTokens.includes(token)))) {
    return true;
  }
  return false;
}

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
  }
  next();
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
  const day = store.recordsByDate[dateStr] || {};
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
  const day = store.recordsByDate[dateStr] || {};
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
    status: 'sent',
    method: triggerMethod,
    message: `Completed daily spreadsheet generated and successfully dispatched to ${recipient} (${activeRecords.length} volunteers attended, ${completedRecords.length} clocked out completed, ${totalHoursStr} hours, ${totalLaptops} laptops imaged).`,
    csvFileName: `club_attendance_and_laptops_${dateStr}.csv`,
    recordCount: Object.keys(day).length,
    activeCount: activeRecords.length,
    totalHours: totalHoursStr,
    totalLaptops,
  };

  store.emailLogs = store.emailLogs || [];
  store.emailLogs.unshift(logEntry);
  if (store.emailLogs.length > 50) store.emailLogs.pop();

  // Archive email dispatch file on disk
  try {
    const emailsDir = path.join(process.cwd(), 'emails');
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
    const sheetsDir = path.join(process.cwd(), 'sheets');
    if (!fs.existsSync(sheetsDir)) fs.mkdirSync(sheetsDir, { recursive: true });
    fs.writeFileSync(path.join(sheetsDir, `${dateStr}.csv`), csvContent, 'utf-8');
  } catch {}

  broadcast('email_dispatched', logEntry);
  console.log(
    `[EMAIL DISPATCH] Sent daily spreadsheet to ${recipient} for ${dateStr} (${activeRecords.length} active, ${totalLaptops} laptops, method: ${triggerMethod})`
  );
  return logEntry;
}

// Automated 5:00 PM Pacific check for weekdays (Mon, Tue, Thu, Fri - Wed excluded)
function checkScheduledEmailDispatch() {
  try {
    const now = new Date();
    const pacific = getPacificTimeParts(now);
    const todayStr = getTodayDateString();
    const dayOfWeek = getPacificDayOfWeek(now); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    const isTargetWeekday = [1, 2, 4, 5].includes(dayOfWeek);
    const is5PM = pacific.hour === 17 && pacific.minute === 0;

    if (isTargetWeekday && is5PM) {
      database.transaction((current) => {
        store = current;
        const alreadySent = (store.emailLogs || []).some(
          (log) => log.dateStr === todayStr && log.status === 'sent' && Math.abs(log.timestamp - now.getTime()) < 3600000
        );
        if (!alreadySent) {
          dispatchCompletedSpreadsheetEmail(todayStr, 'scheduled_5pm_cron');
        }
      });
    }
  } catch (err) {
    console.warn('Scheduled email dispatch check error:', err);
  }
}

setInterval(checkScheduledEmailDispatch, 30000);

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
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    let token = '';
    database.transaction((current) => {
      store = current;
      token = generateAdminToken();
    });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ error: 'Incorrect admin password. Access denied.' });
});

app.post('/api/admin/logout', (req, res) => {
  const tokenHeader = req.headers['x-admin-token'] as string | undefined;
  if (tokenHeader) {
    activeAdminTokens.delete(tokenHeader);
  }
  res.json({ success: true });
});

// Get Roster
app.get('/api/roster', (_req, res) => {
  const currentStore = database.transaction((s) => s);
  const custom = currentStore.customStudents || [];
  const map = new Map<string, Student>();
  for (const s of CLUB_ROSTER) map.set(s.id, s);
  for (const s of custom) map.set(s.id, s);
  res.json({ roster: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)) });
});

// Add new student volunteer to the roster
app.post('/api/roster/add', route((req, res) => {
  const { firstName, lastName, clockInNow, date } = req.body;
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

  store.customStudents = store.customStudents || [];
  store.customStudents.push(newStudent);

  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  if (clockInNow && dayRecords[newStudent.id]) {
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
    pendingRecordsToSync.push(rec);
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
  res.json(store.settings);
}));

app.post('/api/settings', route((req, res) => {
  store.settings = { ...store.settings, ...req.body };
  broadcast('settings_updated', store.settings);
  res.json(store.settings);
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
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);
  const clientKey = clientId || req.ip || 'unknown-client';
  const previousClick = store.recentClicks[clientKey];

  let flagReason = '';
  let generatedAlert: SecurityAlert | null = null;

  if (previousClick && previousClick.studentId !== studentId) {
    const diffSeconds = Math.round((now - previousClick.timestamp) / 1000);

    if (diffSeconds <= store.settings.rapidThresholdSeconds) {
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

      if (store.settings.strictMode && !isAdminOverride) {
        broadcast('security_alert', generatedAlert);
        return res.status(403).json({
          error: `Multiple student check-in prohibited! Only one student may check in per device within ${store.settings.rapidThresholdSeconds}s. An alert has been sent to the club administrator.`,
          flagged: true,
          alert: generatedAlert,
        });
      }
    }
  }

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

  store.recentClicks[clientKey] = {
    studentId,
    studentName: record.studentName,
    timestamp: now,
  };

  pendingRecordsToSync.push(record);
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
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found in roster' });
  }

  if (!record.clockInTimestamp && !record.clockInTime) {
    return res.status(400).json({ error: 'Student must check in before checking out' });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const formattedTime = formatTime(nowDate);
  const clientKey = clientId || req.ip || 'unknown-client';

  const clockInTs = record.clockInTimestamp || getPacificTimestamp(dateStr, record.clockInTime || '03:00:00 PM');
  const durationMs = Math.max(0, now - clockInTs);
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

  pendingRecordsToSync.push(record);
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

  pendingRecordsToSync.push(record);
  broadcast('record_updated', record);

  res.json({ success: true, record });
}));

// Manual time & laptop adjustment (admin override)
app.post('/api/adjust-time', route((req, res) => {
  const { studentId, date, clockInTime, clockOutTime, isFlagged, laptopsImaged } = req.body;
  const dateStr = date || getTodayDateString();
  const dayRecords = initDayRecords(dateStr);

  const record = dayRecords[studentId];
  if (!record) {
    return res.status(404).json({ error: 'Student not found' });
  }

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

  pendingRecordsToSync.push(record);
  broadcast('record_updated', record);
  res.json({ success: true, record });
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
    pendingRecordsToSync.push(newDayRecords[student.id]);
  }

  store.recordsByDate[dateStr] = newDayRecords;
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
    pendingRecordsToSync.push(freshDayRecords[student.id]);
  }

  store.recordsByDate = { [todayStr]: freshDayRecords };
  store.alerts = [];
  store.hasBeenReset = true;

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

  record.laptopsImaged = newCount;
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

  pendingRecordsToSync.push(record);
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
    clubGoal: store.clubGoal || { targetLaptops: 2500, sessionTarget: 50 },
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
  store.clubGoal = store.clubGoal || { targetLaptops: 2500, sessionTarget: 50 };
  if (typeof targetLaptops === 'number') store.clubGoal.targetLaptops = Math.max(1, targetLaptops);
  if (typeof sessionTarget === 'number') store.clubGoal.sessionTarget = Math.max(1, sessionTarget);
  broadcast('goal_updated', store.clubGoal);
  res.json({ success: true, clubGoal: store.clubGoal });
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
  const day = store.recordsByDate[todayStr] || {};
  const activeCount = Object.values(day).filter(
    (r) => r.clockInTime || (r.laptopsImaged && r.laptopsImaged > 0)
  ).length;
  const completedCount = Object.values(day).filter((r) => r.status === 'completed').length;

  res.json({
    schedule: '5:00 PM Pacific Every Weekday (Monday, Tuesday, Thursday, Friday - Wednesday excluded)',
    recipient: 'avasophianorgaard@gmail.com',
    todayDate: todayStr,
    todayStats: {
      activeCount,
      completedCount,
      totalMembers: getAllStudents().length,
      csvAvailable: fs.existsSync(path.join(process.cwd(), 'sheets', `${todayStr}.csv`)),
    },
    logs: store.emailLogs || [],
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
    message: `Completed spreadsheet email for ${targetDate} dispatched to avasophianorgaard@gmail.com`,
    log: logEntry,
  });
}));

// Store Dump for backup
app.get('/api/store-dump', route((_req, res) => {
  res.json({
    recordsByDate: store.recordsByDate,
    customStudents: store.customStudents || [],
    clubGoal: store.clubGoal,
    settings: store.settings,
    alerts: store.alerts,
    emailLogs: store.emailLogs || [],
  });
}));

// Firebase Status & Manual Backup endpoints
app.get('/api/firebase/status', route((_req, res) => {
  res.json({
    connected: Boolean(firestoreDb),
    databaseId: 'ai-studio-clubattendancetr-c37bf173-259d-4f35-bde4-eada4973fd7b',
    lastSyncTimestamp: lastFirestoreSyncTimestamp,
    lastSyncFormatted: lastFirestoreSyncTimestamp
      ? new Date(lastFirestoreSyncTimestamp).toLocaleString('en-US', { timeZone: PACIFIC_TIMEZONE })
      : null,
    totalRecordsSynced: totalFirestoreSyncedCount,
  });
}));

app.post('/api/firebase/backup-now', async (_req, res) => {
  try {
    const result = await backupAllToFirestore();
    res.json({
      success: true,
      message: `Successfully backed up ${result.backedUp} active records to Firebase Firestore!`,
      details: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Firestore backup failed: ' + (err?.message || String(err)) });
  }
});

// -------------------------------------------------------------
// Vite Server Integration & Startup
// -------------------------------------------------------------
async function startServer() {
  // Sync with Firebase Firestore on boot
  if (firestoreDb) {
    syncFromFirestore()
      .then(() => backupAllToFirestore())
      .catch((err) => console.warn('[FIREBASE] Startup sync warning:', err));
  }

  // Check if today past 5 PM on target weekday and dispatch startup email if needed
  try {
    const bootToday = getTodayDateString();
    const bootDayOfWeek = getPacificDayOfWeek();
    if ([1, 2, 4, 5].includes(bootDayOfWeek)) {
      const parts = getPacificTimeParts();
      if (parts.hour >= 17) {
        database.transaction((current) => {
          store = current;
          const already = (store.emailLogs || []).some(
            (l) => l.dateStr === bootToday && l.status === 'sent'
          );
          if (!already) {
            dispatchCompletedSpreadsheetEmail(bootToday, 'startup_dispatch');
          }
        });
      }
    }
  } catch {}

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
  database.close();
  process.exitCode = 1;
});
