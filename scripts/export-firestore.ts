/** Read-only live export. Run with a server identity authorized to read Firestore. */
import fs from 'node:fs';
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
    const recordsByDate: Record<string,Record<string,any>>=Object.create(null);
    const generation=metadata.data()?.activeGeneration;
    for(const document of records.docs){
      const record=document.data();
      if(generation && record.storageGeneration!==generation)continue;
      if(document.id!==`${record.date}_${record.studentId}`)throw new Error('Invalid record identity in live snapshot');
      (recordsByDate[record.date]||=Object.create(null))[record.studentId]=record;
    }
    const meta=metadata.data()||{};
    return {recordsByDate,settings:meta.settings,alerts:meta.alerts,clubGoal:meta.clubGoal,customStudents:students.docs.map(d=>d.data()),
      exportedAt:new Date().toISOString(),source:'firebase-read-only-snapshot'};
  });
  fs.writeFileSync(output,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Read-only snapshot saved. No database changes were made.');
} finally { await db.terminate(); }
