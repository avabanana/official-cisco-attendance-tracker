/** Read-only live export. Run with a server identity authorized to read Firestore. */
import fs from 'node:fs';
import { snapshotRecords } from './snapshot-data.ts';
import { firebaseDatabase } from '../server/persistence.ts';
const output=process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/export-firestore.ts <new-snapshot.json>');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing snapshot');
const db=firebaseDatabase();
try {
  const snapshot=await db.runTransaction(async transaction=>{
    const [records,metadata,students]=await Promise.all([
      transaction.get(db.collection('attendance_records')),transaction.get(db.doc('attendance_internal/state')),transaction.get(db.collection('students')),
    ]);
    const attendance = snapshotRecords(records.docs, metadata.data()?.activeGeneration);
    const meta=metadata.data()||{};
    return {...attendance,settings:meta.settings,alerts:meta.alerts,clubGoal:meta.clubGoal,customStudents:students.docs.map(d=>d.data()),
      exportedAt:new Date().toISOString(),source:'firebase-read-only-snapshot'};
  });
  fs.writeFileSync(output,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Read-only snapshot saved. No database changes were made.');
  console.log(JSON.stringify(snapshot.exportSummary));
  if (snapshot.exportSummary.quarantinedDocuments) console.log('Some documents need identity review. Their original IDs and complete data are preserved in quarantinedRecords and rawRecords; no repairs were applied.');
} finally { await db.terminate(); }
