import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { AttendanceDatabase, emptyStore, type StoreData } from '../storage.ts';
import config from '../firebase-applet-config.json';

export interface Persistence {
  transaction<T>(date: string | null, operation: (store: StoreData) => T, write?: boolean): Promise<T>;
  close(): void | Promise<void>;
}
function normalize(store: StoreData): StoreData {
  store.recentClicks = Object.assign(Object.create(null), store.recentClicks || {});
  store.recordsByDate = Object.assign(Object.create(null), store.recordsByDate);
  for (const date of Object.keys(store.recordsByDate)) store.recordsByDate[date] = Object.assign(Object.create(null), store.recordsByDate[date]);
  store.deviceBindings = Object.assign(Object.create(null), store.deviceBindings || {});
  store.customStudents ||= [];
  store.clubGoal ||= { targetLaptops: 250, sessionTarget: 30 };
  store.adminSessions = Object.assign(Object.create(null), store.adminSessions || {});
  return store;
}
export class LocalPersistence implements Persistence {
  readonly database: AttendanceDatabase;
  constructor(filename: string) { this.database = new AttendanceDatabase(filename); }
  async transaction<T>(_date: string | null, operation: (store: StoreData) => T): Promise<T> {
    return this.database.transaction(store => operation(normalize(store)));
  }
  close() { this.database.close(); }
}

export class FirestorePersistence implements Persistence {
  constructor(readonly db: Firestore) {}
  async transaction<T>(date: string | null, operation: (store: StoreData) => T, write = true): Promise<T> {
    return this.db.runTransaction(async transaction => {
      const metaRef = this.db.doc('attendance_internal/state');
      const recordQuery = date ? this.db.collection('attendance_records').where('date', '==', date) : this.db.collection('attendance_records');
      const [meta, records, students] = await Promise.all([
        transaction.get(metaRef), transaction.get(recordQuery), transaction.get(this.db.collection('students')),
      ]);
      const defaults = emptyStore();
      const saved = meta.data();
      if (!saved) {
        // Read legacy collections without replaying attendance or manufacturing history.
        const [legacySettings, legacyAlerts] = await Promise.all([
          transaction.get(this.db.collection('settings')), transaction.get(this.db.collection('alerts')),
        ]);
        for (const entry of legacySettings.docs) {
          const values = entry.data();
          for (const key of ['strictMode','soundAlerts','kioskMode','rapidThresholdSeconds']) {
            if (key in values) (defaults.settings as any)[key] = values[key];
          }
          if (typeof values.targetLaptops === 'number' && typeof values.sessionTarget === 'number') defaults.clubGoal = { targetLaptops: values.targetLaptops, sessionTarget: values.sessionTarget };
        }
        defaults.alerts = legacyAlerts.docs.map(d => d.data() as any).sort((a,b) => b.timestamp-a.timestamp).slice(0,200);
      }
      if (saved && saved.schemaVersion !== 1) throw new Error('Unsupported Firestore schema version');
      const store = normalize({ ...defaults, ...saved, recordsByDate: {} } as StoreData);
      const roster = new Map(store.customStudents!.map(s => [s.id, s]));
      for (const student of students.docs) roster.set(student.id, student.data() as any);
      store.customStudents = [...roster.values()];
      const original = new Map<string, string>();
      const rawRecords = new Map(records.docs.map(document => [document.id, document.data()]));
      for (const document of records.docs) {
        const record = document.data() as any;
        if (store.activeGeneration && record.storageGeneration !== store.activeGeneration) continue;
        if (record.id !== document.id || document.id !== `${record.date}_${record.studentId}` ||
            !['absent', 'checked_in', 'completed'].includes(record.status)) throw new Error('Invalid stored attendance identity/status; refusing to overwrite');
        store.recordsByDate[record.date] ||= Object.create(null);
        store.recordsByDate[record.date][record.studentId] = record;
        original.set(document.id, JSON.stringify(record));
      }
      const beforeMeta = metadata(store);
      const result = operation(store); // Synchronous, repeatable; no network, SSE, or response side effects here.
      if (write) {
        let writes = 0;
        const retained = new Set<string>();
        for (const day of Object.values(store.recordsByDate)) for (const record of Object.values(day)) {
          retained.add(record.id);
          if (store.activeGeneration) (record as any).storageGeneration = store.activeGeneration;
          const json = JSON.stringify(record);
          if (original.get(record.id) !== json) {
            const previous = rawRecords.get(record.id);
            if (previous && store.activeGeneration && previous.storageGeneration !== store.activeGeneration) {
              const previousGeneration = previous.storageGeneration || 'legacy';
              if (!/^[a-zA-Z0-9_-]+$/.test(previousGeneration)) throw new Error('Invalid archived generation');
              transaction.set(this.db.doc(`attendance_archives/${previousGeneration}/records/${record.id}`), previous);
              writes++;
            }
            transaction.set(this.db.doc(`attendance_records/${record.id}`), JSON.parse(json)); writes++;
          }
        }
        for (const id of original.keys()) if (!retained.has(id) && store.activeGeneration === saved?.activeGeneration) { transaction.delete(this.db.doc(`attendance_records/${id}`)); writes++; }
        // Bulk repairs/reset are deliberately scoped to a date, never an unbounded batch.
        if (writes > 450) throw new Error('Too many records for one atomic operation; use reviewed per-date reconciliation');
        const afterMeta = metadata(store);
        if (beforeMeta !== afterMeta) transaction.set(metaRef, JSON.parse(afterMeta));
      }
      return result;
    }, write ? undefined : { readOnly: true });
  }
  close() { return this.db.terminate(); }
}
function metadata(store: StoreData): string {
  const { recordsByDate, ...meta } = store;
  // Include all server-side settings, audit history, and anti-proxy state, never legacy adminTokens.
  delete (meta as any).adminTokens;
  return JSON.stringify({ ...meta, schemaVersion: 1 });
}
export function firebaseDatabase(): Firestore {
  const projectId = process.env.FIREBASE_PROJECT_ID || config.projectId;
  const app = getApps()[0] || initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  return getFirestore(app, process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId);
}
