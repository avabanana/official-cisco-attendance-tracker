import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { FirestorePersistence } from '../server/persistence.ts';
import { blank, checkIn, checkOut, dayRecords } from '../server/attendance.ts';
import { CLUB_ROSTER } from '../src/data/roster.ts';

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
test('Firestore emulator: committed history, concurrent writers, failed transactions, rules, and read-only startup', { skip: !enabled }, async t => {
  const projectId = 'demo-attendance';
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  const environment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules','utf8') } });
  await environment.clearFirestore();
  t.after(() => environment.cleanup());
  const app = initializeApp({ projectId }, 'attendance-emulator-test');
  const db = getFirestore(app);
  const persistence = new FirestorePersistence(db);
  t.after(async () => { await persistence.close(); await deleteApp(app); });
  const date = '2026-10-16';
  // Rendering any date/roster creates no attendance or metadata documents.
  await persistence.transaction(date, store => assert.ok(dayRecords(store,date).every(r => r.status === 'absent')), false);
  assert.equal((await db.collection('attendance_records').get()).size,0);
  assert.equal((await db.collection('attendance_internal').get()).size,0);
  const student = CLUB_ROSTER[0];
  await persistence.transaction(date, store => {
    const r=blank(date,student); checkIn(r,Date.parse('2026-10-16T22:00:00Z'),'device');
    checkOut(r,Date.parse('2026-10-16T22:30:00Z'),'device');
    checkIn(r,Date.parse('2026-10-16T22:45:00Z'),'device');
    checkOut(r,Date.parse('2026-10-16T23:00:00Z'),'device');
    (store.recordsByDate[date] ||= {})[student.id]=r;
  });
  let record=(await db.doc(`attendance_records/${date}_${student.id}`).get()).data()!;
  assert.equal(record.durationMinutes,45); assert.equal(record.history.length,4);
  await assert.rejects(persistence.transaction(date, store => { store.recordsByDate[date][student.id].status='absent'; throw new Error('simulated failure'); }));
  assert.equal((await db.doc(`attendance_records/${date}_${student.id}`).get()).data()!.status,'completed');
  // Independent concurrent requests must not lose either new arrival.
  await Promise.all(CLUB_ROSTER.slice(1,4).map(person => persistence.transaction(date, store => {
    const record=blank(date,person); checkIn(record,Date.parse('2026-10-16T22:00:00Z'),person.id);
    (store.recordsByDate[date] ||= {})[person.id]=record;
    store.settings.soundAlerts=false;
  })));
  assert.equal((await db.collection('attendance_records').get()).size,4);
  const anonymous=environment.unauthenticatedContext().firestore();
  const adminBrowser=environment.authenticatedContext('admin', { email:'avasophianorgaard@gmail.com',email_verified:true }).firestore();
  await assertSucceeds(getDoc(doc(anonymous,'attendance_records',`${date}_${student.id}`)));
  for(const client of [anonymous,adminBrowser]) {
    await assertFails(setDoc(doc(client,'attendance_records',`${date}_${student.id}`),{...record,status:'checked_in'}));
    await assertFails(setDoc(doc(client,'settings','security'),{strictMode:false}));
    await assertFails(getDoc(doc(client,'attendance_internal','state')));
  }
  // Global reset archives old generations instead of deleting history; stale documents cannot reappear.
  await persistence.transaction(null, store => { store.activeGeneration='reset-test-generation';store.recordsByDate={}; });
  await persistence.transaction(null, store => assert.equal(Object.keys(store.recordsByDate).length,0),false);
  assert.equal((await db.collection('attendance_records').get()).size,4);
  await persistence.transaction(date, store => {
    const r=blank(date,student); checkIn(r,Date.parse('2026-10-16T22:00:00Z'),'device');
    (store.recordsByDate[date] ||= {})[student.id]=r;
  });
  assert.equal((await db.doc(`attendance_archives/legacy/records/${date}_${student.id}`).get()).data()!.history.length,4);
  const {reconcile,digest}=await import('../scripts/apply-reconciliation.ts');
  const current=(await db.doc(`attendance_records/${date}_${student.id}`).get()).data()!;
  const change={date,studentId:student.id,id:current.id,source:'attendance_2026-10-16.csv',sourceSha256:'test-source',row:2,
    before:current,beforeSha256:digest(current),after:{...current,laptopsImaged:7}};
  const plan={version:1,changes:[change]};
  const dry=await reconcile(db,plan,'test-approved-plan',false);assert.equal(dry.corrected,0);
  assert.equal((await db.doc(`attendance_records/${current.id}`).get()).data()!.laptopsImaged,0);
  await reconcile(db,plan,'test-approved-plan',true);
  assert.equal((await db.doc(`attendance_records/${current.id}`).get()).data()!.laptopsImaged,7);
  assert.equal((await db.doc(`attendance_reconciliations/test-approved-plan/records/${current.id}`).get()).data()!.before.laptopsImaged,0);
  assert.equal((await reconcile(db,plan,'test-approved-plan',true)).corrected,0);
  await assert.rejects(reconcile(db,plan,'different-plan',true),/Conflict/);
  const {identityRepairs,applyIdentityRepairs}=await import('../scripts/repair-confirmed-identities.ts');
  const identityDate='2026-10-13';
  const alias={...blank(identityDate,{id:'storment-isaac',name:'Storment, Isaac',firstName:'Isaac',lastName:'Storment'}),
    status:'completed',durationMinutes:88,laptopsImaged:3,storageGeneration:'reset-test-generation'};
  const canonical={...blank(identityDate,{id:'storment',name:'Storment, Isaac',firstName:'Isaac',lastName:'Storment'}),storageGeneration:'reset-test-generation'};
  await db.doc(`attendance_records/${alias.id}`).set(alias);
  await db.doc(`attendance_records/${canonical.id}`).set(canonical);
  const repairs=identityRepairs({recordsByDate:{[identityDate]:{'storment-isaac':alias,storment:canonical}}});
  assert.equal((await applyIdentityRepairs(db,repairs,false)).merged,0);
  assert.equal((await db.doc(`attendance_records/${alias.id}`).get()).exists,true);
  assert.equal((await applyIdentityRepairs(db,repairs,true)).merged,1);
  assert.equal((await db.doc(`attendance_records/${alias.id}`).get()).exists,false);
  assert.equal((await db.doc(`attendance_records/${canonical.id}`).get()).data()!.durationMinutes,88);
  assert.equal((await db.doc(`attendance_records/${canonical.id}`).get()).data()!.laptopsImaged,3);
  assert.equal((await applyIdentityRepairs(db,repairs,true)).merged,0);
  await assert.rejects(applyIdentityRepairs(db,[{...repairs[0],source:{...alias,laptopsImaged:4}}],true),/changed since export/);
  const {emptyTestRepair,archiveEmptyTest}=await import('../scripts/archive-empty-test-record.ts');
  const confirmedCanonical=(await db.doc(`attendance_records/${canonical.id}`).get()).data()!;
  const emptyAlias={...canonical,id:'test-rec-1'};
  await db.doc('attendance_records/test-rec-1').set(emptyAlias);
  const cleanup=emptyTestRepair({rawRecords:[{documentId:'test-rec-1',data:emptyAlias}],recordsByDate:{[identityDate]:{storment:confirmedCanonical}}});
  assert.equal((await archiveEmptyTest(db,cleanup,false)).archived,0);
  assert.equal((await db.doc('attendance_records/test-rec-1').get()).exists,true);
  assert.equal((await archiveEmptyTest(db,cleanup,true)).archived,1);
  assert.equal((await db.doc('attendance_records/test-rec-1').get()).exists,false);
  assert.deepEqual((await db.doc(`attendance_records/${canonical.id}`).get()).data(),confirmedCanonical);
  assert.equal((await db.collection('attendance_test_archives').get()).size,1);
  assert.equal((await archiveEmptyTest(db,cleanup,true)).alreadyArchived,true);
  await persistence.transaction(null,store=>assert.ok(store.recordsByDate[identityDate].storment),false);
  const guardBefore=(await db.doc(`attendance_records/${canonical.id}`).get()).data()!;
  const guardedPlan={version:1,requiredAbsentAttendanceIds:['test-rec-1'],changes:[{date:identityDate,studentId:'storment',id:canonical.id,
    source:'attendance_2026-10-13.csv',sourceSha256:'test-source',row:2,before:guardBefore,beforeSha256:digest(guardBefore),after:{...guardBefore,laptopsImaged:4}}]};
  assert.equal((await reconcile(db,guardedPlan,'absent-guard-dry-run',false)).corrected,0);
  await db.doc('attendance_records/test-rec-1').set(emptyAlias);
  await assert.rejects(reconcile(db,guardedPlan,'absent-guard-block',true),/present again/);
  assert.deepEqual((await db.doc(`attendance_records/${canonical.id}`).get()).data(),guardBefore);



});
