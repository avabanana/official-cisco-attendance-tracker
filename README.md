# Club Attendance Tracker

Attendance is **manual**. Opening the app, selecting a date, adding a roster
entry without checking “clock in now,” starting the server, polling, and
verifying Firebase never check anybody in. A deliberate member or authenticated
admin action must commit successfully before the UI displays it as saved.

## Storage and deployment requirements

Use Node 24 LTS (minimum 22.13), `npm ci`, and `npm run dev`.
Production uses **Firestore as the authoritative database**, including ordered
history, laptop logs, admin exceptions, settings, alerts, device bindings, and
expiring admin sessions. No browser sync is required. The former sync button
performs a read-only verification; neither startup nor page load imports,
seeds, merges, or replays attendance.

The server uses the Firebase Admin SDK and Application Default Credentials.
On Cloud Run, grant its runtime service account the appropriate Firestore IAM
access (normally `roles/datastore.user`) to the configured project/database.
Use the attached service identity; do not place service-account JSON in the
client or repository. The default project/database come from
`firebase-applet-config.json`; server overrides are `FIREBASE_PROJECT_ID` and
`FIRESTORE_DATABASE_ID`. `PORT` defaults to 3000 and listens on all interfaces.
Set `ADMIN_PASSWORD` through Cloud Run Secret Manager configuration. There is
no fallback password. Rotate the old password that was committed in previous
versions of this repository. Admin sessions expire after eight hours and are
revoked across instances when logged out.

Firestore rules deny browser writes, including signed-in admin browsers; all
mutations must pass server validation and authentication. Deploy the reviewed
`firestore.rules` to the **named database actually used by this app**, alongside
the server change. Deploying rules to `(default)` does not protect a different
named database. Public roster/attendance reads retain the previous app's access
behavior. Alerts require verified admin identity; private server state,
archives, and reconciliation backups are denied to browser clients.

A request performs a Firestore transaction. Only the committed attempt emits
SSE events or a success response. Failed storage operations return 503 rather
than claiming data was retained. Multiple server instances load shared state
under Firestore transactions. SSE is local to an instance; read-only polling
also refreshes attendance every 30 seconds. No ephemeral SQLite fallback is
allowed on Cloud Run.

Local tests may explicitly select `ATTENDANCE_STORAGE=sqlite` with a disposable
`ATTENDANCE_DB_PATH`. This is not a production migration path. Retained legacy
JSON/SQLite data is never imported automatically. Do not delete those sources.

## Attendance invariants

- Displayed records belong to the selected Pacific date. Out-of-order fetches
  and cached browser attendance cannot carry yesterday's arrivals into today.
- No optimistic check-in/check-out or success sound precedes a server commit.
  An uncertain network result is reloaded, never replayed automatically.
- Re-In clears the current departure and retains ordered history, laptop logs,
  and previously completed minutes. Subsequent checkout adds the new active
  session only, excluding the time away. Duplicate active check-ins and
  duplicate completed checkouts do not append history or change timestamps.
- Self-service changes require a device ID, today's Pacific date, and explicit
  manual intent. One device is bound to one student for the day. Authenticated
  admin actions can assist students and change historical records. The existing
  anonymous kiosk workflow does not verify a student's real-world identity;
  device IDs are not a substitute for per-student authentication.
- Early self check-in is blocked before 3 PM Pacific. Checkout notices after
  4:15 PM and the 4:45 PM cap/explicit admin exception flow are handled server-side.
- Adding laptop counts does not mark attendance. Roster creation defaults to
  no check-in; only an admin's explicit `clockInNow: true` checks in the new member.
- Resets are explicit admin operations. Day reset preserves an audit history;
  global reset changes the active generation and archives overwritten records
  instead of allowing old records to reappear through a merge.

## Historical data review (do not deploy or overwrite without approval)

The retired `import-user-csvs.ts` and `sync-all-to-db-and-firestore.ts` scripts
contained hardcoded/mirrored attendance and import-time side effects. They now
refuse to run. In particular, October 13 must never be inferred from October 12.

First obtain a **read-only** live snapshot using an authorized server identity:

```sh
npm run snapshot:firestore -- /secure/new-live-snapshot.json
python3 scripts/reconcile-attendance.py \
  --csv-dir /secure/supplied-csvs \
  --snapshot /secure/new-live-snapshot.json \
  --baseline firebase-read-only-snapshot \
  --out /secure/review
```

The planner never writes Firebase or source files. It matches unique exact
student names, preserves source checksums/row numbers, and quarantines filenames
marked inaccurate or data lost. Missing rows/dates are not invented. Conflicting
status/times or ambiguous identities remain unresolved. CSVs cannot reconstruct
lost event history or device identities. Keep the report and plan private.

Review the proposed per-record differences, resolve outstanding source issues,
and obtain approval. A dry-run live conflict check is:

```sh
npm run reconcile:check -- /secure/review/correction-plan.json
```

Only after approval, passing emulator tests, and a verified backup, pass the
exact SHA-256 of the approved plan file to enable writes:

```sh
npm run reconcile:check -- /secure/review/correction-plan.json \
  --approve-plan-sha256 APPROVED_FILE_SHA256
```

This validates identities, rejects inaccurate sources and stale baseline
hashes, and applies **one date atomically at a time**. Before/after documents and
CSV provenance are saved in private `attendance_reconciliations` documents in
the same transaction. Earlier dates may commit before a later conflict; reruns
skip already audited corrections. Existing ordered history is retained, with a
`csv_reconcile` audit entry, never fabricated check-in events. It cannot resurrect
records from a subsequent global reset. Never replace Firebase wholesale with
a proposed JSON copy or a repository backup.

## Validation and current limits

```sh
npm run lint
npm test
npm run build
XDG_CONFIG_HOME=/tmp/attendance-tools/config \
XDG_CACHE_HOME=/tmp/attendance-tools/cache \
FIREBASE_EMULATORS_PATH=/tmp/attendance-emulators npm run test:emulator
```

Local API/UI tests use disposable synthetic data. They exercise poisoned
browser caches, date-response races, no automatic POSTs, failed manual actions,
re-in/history, security controls, durable reopen, and failed writes.
The separate Firestore suite requires the official emulator download and checks
transactions, concurrent writers, rules against anonymous/admin browser writes,
read-only date loads, and archived reset generations. Ordinary `npm test`
explicitly reports it skipped when the emulator is absent. A skipped emulator
suite does not validate Firebase or deployed rules.

Local validation and the real Firestore emulator suite passed after the Google
network settings were activated. A user-authorized Cloud Shell export also
succeeded. This Codex workspace itself has no Google server credentials.
The live export revealed a noncanonical test document and missing historical
history/log fields; data reconciliation remains subject to identity review,
fresh conflict checks, and explicit approval. No deployment, live import, or
live attendance overwrite was performed during these checks.


The historical email button generates an export and a pending dispatch log;
there is no configured email transport in this source. It does not claim that
an email was delivered. Manual archive files are written after commit under
ignored `data/archives`, never over the source attendance sheets.

The `Attendance regression tests` GitHub Actions workflow runs the local checks
and the real Firestore emulator suite against `demo-attendance`, without live
Firebase credentials or deployment. Its outcome must be checked before merge;
adding the workflow is not evidence that it has run or passed.

Read-only exports preserve every attendance document with its original Firestore
ID in `rawRecords`. Invalid/mismatched identities are also listed in
`quarantinedRecords` rather than aborting the export, guessing IDs, or replacing
a valid record with a legacy alias. Archived generations remain in the raw
export. CSV plans flag these unresolved documents and refuse application until
the identity issues have been reviewed and a new plan generated.

CSV comparison treats leading-zero time formatting as equivalent and preserves
existing millisecond event timestamps when the CSV represents the same second.
It never truncates genuine event precision merely to reproduce export formatting.
