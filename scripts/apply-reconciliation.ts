/** Defaults to a read-only conflict check. Writes require an explicitly approved plan hash. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { firebaseDatabase } from '../server/persistence.ts';

export function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function digest(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export async function reconcile(db: ReturnType<typeof firebaseDatabase>, plan: any, planHash: string, apply: boolean) {
  if (plan.quarantinedDocuments > 0) throw new Error('Resolve quarantined document identities and regenerate the plan before applying any corrections');
  if (plan.version !== 1 || !Array.isArray(plan.changes)) throw new Error('Unsupported correction plan');
  const groups = new Map<string, any[]>();
  const ids = new Set<string>();
  for (const change of plan.changes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || !/^[a-zA-Z0-9_-]{1,128}$/.test(change.studentId) ||
        change.id !== `${change.date}_${change.studentId}` || change.after.id !== change.id || change.after.date !== change.date ||
        change.after.studentId !== change.studentId || !['absent','checked_in','completed'].includes(change.after.status) || ids.has(change.id)) throw new Error('Invalid/duplicate correction identity');
    if (/inaccurate|data lost/i.test(change.source)) throw new Error('Uncertain sources cannot be applied');
    if (digest(change.before) !== change.beforeSha256) throw new Error('Plan baseline hash mismatch');
    ids.add(change.id);
    groups.set(change.date, [...(groups.get(change.date)||[]),change]);
  }
  let corrected = 0;
  for (const [date, changes] of groups) {
    if (changes.length > 150) throw new Error('Date exceeds safe transaction limit');
    corrected += await db.runTransaction(async transaction => {
      const [metadata, ...documents] = await transaction.getAll(db.doc('attendance_internal/state'), ...changes.map(c => db.doc(`attendance_records/${c.id}`)));
      const generation = metadata.data()?.activeGeneration;
      const auditRefs = changes.map(c => db.doc(`attendance_reconciliations/${planHash}/records/${c.id}`));
      const audits = await transaction.getAll(...auditRefs);
      let count=0;
      for (let i=0;i<changes.length;i++) {
        const change=changes[i];
        if (audits[i].exists) continue; // Safe reruns after an interrupted multi-date job.
        const current=documents[i].exists ? documents[i].data() : null;
        if (digest(current) !== change.beforeSha256) throw new Error(`Conflict for ${change.id}; export fresh data and review a new plan. No corrections for ${date} were committed.`);
        if (generation && current?.storageGeneration !== generation) throw new Error(`Record ${change.id} is archived by a later reset; refusing resurrection`);
        if (apply) {
          const timestamp=Date.now();
          const after={...change.after, ...(generation ? { storageGeneration:generation } : {}),
            history:[...(change.after.history||[]),{action:'csv_reconcile',timestamp,timeFormatted:new Date(timestamp).toISOString(),clientId:'approved_reconciliation'}],
            revision:(current?.revision||0)+1};
          transaction.create(auditRefs[i], { before:current, after, planHash, date, source:change.source,
            sourceSha256:change.sourceSha256, row:change.row, appliedAt:timestamp });
          transaction.set(documents[i].ref, after);
          count++;
        }
      }
      return count;
    });
  }
  return { checked:ids.size, corrected, applied:apply };
}
// Imported by tests without opening a live connection.
if (process.argv[1]?.endsWith('apply-reconciliation.ts')) {
  const filename=process.argv[2];
  if (!filename) throw new Error('Usage: tsx scripts/apply-reconciliation.ts <plan.json> [--approve-plan-sha256 <hash>]');
  const bytes=fs.readFileSync(filename);const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const approvalIndex=process.argv.indexOf('--approve-plan-sha256');
  const apply=approvalIndex !== -1;
  if (apply && process.argv[approvalIndex+1] !== hash) throw new Error('Approval hash must exactly match the reviewed plan file');
  const db=firebaseDatabase();
  try { console.log(JSON.stringify(await reconcile(db,JSON.parse(bytes.toString()),hash,apply))); }
  finally { await db.terminate(); }
}
