import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { AttendanceRecord, SecurityAlert, SecuritySettings } from './src/types.ts';

export interface StoreData {
  recordsByDate: Record<string, Record<string, AttendanceRecord>>;
  alerts: SecurityAlert[];
  settings: SecuritySettings;
  recentClicks: Record<string, { studentId: string; studentName: string; timestamp: number }>;
}
export function emptyStore(): StoreData {
  return { recordsByDate: {}, alerts: [], recentClicks: {}, settings: {
    rapidThresholdSeconds: 20, strictMode: false, soundAlerts: true, kioskMode: true,
  } };
}

// JSON payloads retain all existing fields and history without lossy conversion.
// SQLite serializes writers across processes; each request reloads under the lock.
export class AttendanceDatabase {
  private db: DatabaseSync;
  constructor(filename: string) {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS attendance_state (
          id INTEGER PRIMARY KEY CHECK(id=1),
          schema_version INTEGER NOT NULL CHECK(schema_version=1),
          payload TEXT NOT NULL CHECK(json_valid(payload))
        );`);
      const result = this.db.prepare('PRAGMA quick_check').get();
      if (!result || Object.values(result)[0] !== 'ok') throw new Error('Database integrity check failed');
    } catch (error) { this.db.close(); throw error; }
  }
  isInitialized(): boolean { return !!this.db.prepare('SELECT id FROM attendance_state').get(); }
  transaction<T>(operation: (store: StoreData) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT payload, schema_version FROM attendance_state WHERE id=1').get();
      if (row && row.schema_version !== 1) throw new Error('Unsupported storage schema');
      const store: StoreData = row ? JSON.parse(String(row.payload)) : emptyStore();
      // Null-prototype dictionaries avoid special student/client IDs mutating prototypes.
      store.recordsByDate = Object.assign(Object.create(null), store.recordsByDate);
      for (const date of Object.keys(store.recordsByDate)) {
        store.recordsByDate[date] = Object.assign(Object.create(null), store.recordsByDate[date]);
      }
      store.recentClicks = Object.assign(Object.create(null), store.recentClicks);
      const result = operation(store);
      this.db.prepare(`INSERT INTO attendance_state VALUES(1,1,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(JSON.stringify(store));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  importLegacy(filename: string) {
    // Parse before starting a transaction; invalid files never create application state.
    const legacy = JSON.parse(fs.readFileSync(filename, 'utf8'));
    validateLegacy(legacy);
    this.transaction((store) => {
      if (this.db.prepare('SELECT id FROM attendance_state').get()) {
        throw new Error('Refusing import: database already initialized');
      }
      Object.assign(store, { ...legacy, settings: { ...store.settings, ...legacy.settings }, recentClicks: {} });
    });
  }
  close() { this.db.close(); }
}

function validateLegacy(value: any) {
  const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value) || !object(value.recordsByDate) || !Array.isArray(value.alerts) || !object(value.settings)) {
    throw new Error('Invalid legacy store structure; source was not modified');
  }
  for (const [date, records] of Object.entries(value.recordsByDate)) {
    if (!object(records)) throw new Error(`Invalid day ${date}`);
    for (const [studentId, record] of Object.entries(records)) {
      const r = record as any;
      if (!object(r) || r.date !== date || r.studentId !== studentId || typeof r.id !== 'string' ||
          typeof r.studentName !== 'string' || !['absent','checked_in','completed'].includes(r.status) ||
          (r.history !== undefined && !Array.isArray(r.history))) throw new Error(`Invalid attendance record for ${date}/${studentId}`);
      for (const entry of r.history || []) {
        if (!object(entry) || !['check_in','check_out','reset'].includes(entry.action) ||
            typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp) ||
            typeof entry.timeFormatted !== 'string' || typeof entry.clientId !== 'string') {
          throw new Error(`Invalid history for ${date}/${studentId}`);
        }
      }
    }
  }
  for (const alert of value.alerts) {
    if (!object(alert) || typeof alert.id !== 'string' || typeof alert.acknowledged !== 'boolean') throw new Error('Invalid security alert');
  }
  for (const [key, entry] of Object.entries(value.settings)) {
    if (key === 'rapidThresholdSeconds' ? typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 :
        ['strictMode','soundAlerts','kioskMode'].includes(key) && typeof entry !== 'boolean') throw new Error(`Invalid setting ${key}`);
  }
}
