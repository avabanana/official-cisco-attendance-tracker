import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { AttendanceDatabase } from '../storage.ts';
import { CLUB_ROSTER } from '../src/data/roster.ts';
import { AttendanceRecord } from '../src/types.ts';
import { parseCsvIntoDayRecords, build1012Records } from './import-user-csvs.ts';

const sheetsDir = path.join(process.cwd(), 'sheets');
const dbPath = path.join(process.cwd(), 'data', 'attendance.sqlite');
const database = new AttendanceDatabase(dbPath);

const dates = [
  '2026-09-12', '2026-09-14', '2026-09-15', '2026-09-21',
  '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-28',
  '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-05',
  '2026-10-06', '2026-10-08', '2026-10-09'
];

async function run() {
  console.log('Starting data alignment and Firestore sync...');

  const allRecordsByDate: Record<string, Record<string, AttendanceRecord>> = Object.create(null);

  // 1. Parse historical dates from sheets
  for (const date of dates) {
    const csvPath = path.join(sheetsDir, `${date}.csv`);
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, 'utf8');
      const dayRecs = parseCsvIntoDayRecords(date, content);
      allRecordsByDate[date] = dayRecs;
      const activeCount = Object.values(dayRecs).filter(r => r.clockInTime).length;
      console.log(`Parsed ${date}: ${activeCount} active volunteers`);
    } else {
      console.warn(`Missing sheets/${date}.csv`);
    }
  }

  // 2. Set 2026-10-12 records (21 volunteers)
  const recs1012 = build1012Records('2026-10-12');
  allRecordsByDate['2026-10-12'] = recs1012;
  console.log(`Set 2026-10-12: ${Object.values(recs1012).filter(r => r.clockInTime).length} active volunteers`);

  // 3. Set 2026-10-13 records: "ALSO, for 10/13, put in the same hours as 10/12 for the same people...."
  const recs1013 = build1012Records('2026-10-13');
  allRecordsByDate['2026-10-13'] = recs1013;
  console.log(`Set 2026-10-13 (mirrored from 10/12): ${Object.values(recs1013).filter(r => r.clockInTime).length} active volunteers`);

  // 4. Update SQLite database under a transaction
  database.transaction((store) => {
    for (const [date, day] of Object.entries(allRecordsByDate)) {
      store.recordsByDate[date] = day;
    }
  });
  console.log('Updated SQLite database with all dates!');

  // 5. Update attendance_store.json and backup
  const storeDump = database.transaction(s => s);
  fs.writeFileSync('attendance_store.json', JSON.stringify(storeDump, null, 2), 'utf8');
  fs.writeFileSync('attendance_store.backup.json', JSON.stringify(storeDump, null, 2), 'utf8');
  console.log('Updated attendance_store.json and attendance_store.backup.json!');

  // 6. Export canonical CSVs for 10/12 and 10/13
  function exportCsv(dateStr: string, day: Record<string, AttendanceRecord>) {
    const headers = [
      'Student Name',
      'Status',
      'Clock In Time',
      'Clock Out Time',
      'Duration',
      'Laptops Imaged (Session)',
      'Flagged Proxy Alert',
      'Flag Reason',
    ];
    const rows = CLUB_ROSTER.map(s => {
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
      const statusDisplay = rec.status === 'completed' ? 'Clocked Out (Completed)' : rec.status === 'checked_in' ? 'Present (Active)' : 'Absent';
      const inTime = rec.clockInTime || '';
      const outTime = rec.clockOutTime || '';
      const dur = rec.durationMinutes !== null && rec.durationMinutes !== undefined ? `${(rec.durationMinutes / 60).toFixed(2)} hrs` : '';
      const laptops = rec.laptopsImaged || 0;
      const flagged = rec.isFlagged ? 'YES - REVIEW' : 'No';
      const reason = rec.flagReason || '';
      return [
        `"${rec.studentName.replace(/"/g, '""')}"`,
        `"${statusDisplay}"`,
        `"${inTime}"`,
        `"${outTime}"`,
        `"${dur}"`,
        laptops,
        `"${flagged}"`,
        `"${reason.replace(/"/g, '""')}"`,
      ].join(',');
    });
    fs.writeFileSync(path.join(sheetsDir, `${dateStr}.csv`), [headers.join(','), ...rows].join('\r\n'), 'utf8');
  }

  exportCsv('2026-10-12', recs1012);
  exportCsv('2026-10-13', recs1013);
  console.log('Saved sheets/2026-10-12.csv and sheets/2026-10-13.csv!');

  // 7. Sync every single active record across ALL dates to Firebase Firestore
  const cfg = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);

  console.log(`Connecting to Firestore database: ${cfg.firestoreDatabaseId}...`);
  let syncedCount = 0;

  for (const [date, day] of Object.entries(allRecordsByDate)) {
    for (const rec of Object.values(day)) {
      if (
        rec.clockInTime ||
        rec.clockOutTime ||
        (rec.durationMinutes && rec.durationMinutes > 0) ||
        (rec.laptopsImaged && rec.laptopsImaged > 0)
      ) {
        const clean = {
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
        await setDoc(doc(db, 'attendance_records', rec.id), clean, { merge: true });
        syncedCount++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`SUCCESSFULLY SYNCED ${syncedCount} ACTIVE RECORDS TO FIRESTORE!`);
  console.log(`All dates including 10/12 and 10/13 are now safely backed up in Firebase.`);
  console.log(`========================================\n`);

  database.close();
}

run().catch(err => {
  console.error('Migration failed:', err);
  database.close();
  process.exit(1);
});
