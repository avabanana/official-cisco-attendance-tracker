/** Only user-confirmed identity repairs. No CSV corrections or test-data deletion. */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { firebaseDatabase } from '../server/persistence.ts';
import { digest } from './apply-reconciliation.ts';
import policy from '../src/data/identity-policy.json';

type Repair = {sourceId:string;targetId:string;source:any;target:any;after:any};
export function identityRepairs(snapshot:any):Repair[] {
  const repairs:Repair[]=[];
  for(const [date,day] of Object.entries(snapshot.recordsByDate) as Array<[string,Record<string,any>]>) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid identity repair date');
    for(const [alias,canonical] of Object.entries(policy.studentIdAliases)) {
      const source=day[alias];if(!source)continue;
      const target=day[canonical]||null;
      if(source.id!==`${date}_${alias}` || source.studentId!==alias || source.date!==date)throw new Error('Invalid alias identity');
      if(target && (target.id!==`${date}_${canonical}` || target.studentId!==canonical || target.date!==date ||
        target.status!=='absent' || target.clockInTime || target.clockOutTime || target.clockInTimestamp || target.clockOutTimestamp ||
        target.durationMinutes || target.laptopsImaged || target.isFlagged || target.history?.length || target.laptopLogs?.length)) {
        throw new Error(`Both identities contain information on ${date}; manual conflict review required`);
      }
      repairs.push({sourceId:source.id,targetId:`${date}_${canonical}`,source,target,
        after:{...source,id:`${date}_${canonical}`,studentId:canonical,studentName:target?.studentName||source.studentName}});
    }
  }
  return repairs;
}
export async function applyIdentityRepairs(db:ReturnType<typeof firebaseDatabase>, repairs:Repair[], apply=false) {
  if(!repairs.length)return {checked:0,merged:0};
  if(repairs.length>100)throw new Error('Too many identities for one atomic repair');
  const planId=digest(repairs);
  return db.runTransaction(async transaction=>{
    const refs=repairs.flatMap(r=>[db.doc(`attendance_records/${r.sourceId}`),db.doc(`attendance_records/${r.targetId}`),db.doc(`attendance_identity_repairs/${planId}/records/${r.sourceId}`)]);
    const documents=await transaction.getAll(db.doc('attendance_internal/state'),...refs);
    const generation=documents[0].data()?.activeGeneration;
    let merged=0;
    for(let i=0;i<repairs.length;i++) {
      const repair=repairs[i];const [source,target,audit]=documents.slice(1+i*3,4+i*3);
      if(audit.exists)continue;
      if(digest(source.exists?source.data():null)!==digest(repair.source) || digest(target.exists?target.data():null)!==digest(repair.target))throw new Error('Identity records changed since export; take a fresh snapshot before repairing');
      if(generation && (repair.source.storageGeneration!==generation || (repair.target && repair.target.storageGeneration!==generation)))throw new Error('Identity was archived by a reset; refusing resurrection');
      if(apply) {
        transaction.create(audit.ref,{sourceBefore:repair.source,targetBefore:repair.target,after:repair.after,appliedAt:Date.now(),reason:'User-confirmed single Isaac Storment; retain attendance once under canonical ID'});
        transaction.set(target.ref,repair.after);
        transaction.delete(source.ref);
        merged++;
      }
    }
    return {checked:repairs.length,merged};
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file=process.argv[2];if(!file)throw new Error('Usage: tsx scripts/repair-confirmed-identities.ts <snapshot.json> [--apply-confirmed-identities]');
  const repairs=identityRepairs(JSON.parse(fs.readFileSync(file,'utf8')));
  const db=firebaseDatabase();
  try{console.log(JSON.stringify(await applyIdentityRepairs(db,repairs,process.argv.includes('--apply-confirmed-identities'))));}
  finally{await db.terminate();}
}
