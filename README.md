# Club Attendance Tracker

## Development

Use Node.js 24 LTS (minimum 22.13 for `node:sqlite`), then:

```sh
npm ci
npm run dev
```

The interface, API URLs, response shapes, CSV export, SSE events, check-in/out
history, admin adjustments/reset, alerts, and strict-mode behavior are retained.
`PORT` defaults to 3000. `ATTENDANCE_DB_PATH` defaults to
`data/attendance.sqlite`, relative to the working directory. No database service
or database credentials are required. `npm run lint`, `npm test`, and
`npm run build` validate the application. For production builds use
`NODE_ENV=production npm start`.

## Storage design

SQLite stores a versioned, lossless JSON document containing attendance by date,
records and their ordered history, security alerts, settings, and recent client
check-ins. Keeping the document format avoids a lossy rewrite of historical
fields and preserves unknown legacy fields. This intentionally favors the small
club workload over large-scale analytics: each request reads the document and
commits its resulting state, so cost grows with total stored history.

Every stateful API operation uses `BEGIN IMMEDIATE`, reloading the latest state
under the writer lock. Concurrent processes cannot overwrite stale snapshots.
WAL journaling, `synchronous=FULL`, a five-second lock timeout, and an integrity
check protect persistence. Responses and SSE updates are emitted only after
commit. A failed transaction rolls back and returns HTTP 503 with an error;
retry after correcting disk space, permissions, or lock contention. Startup
fails if the database cannot be opened or is corrupt; it never silently starts
with empty data. Recent client checks persist, including across server restarts.
SSE connections remain local to one server process, as before; use a single
server instance for real-time fan-out.

Keep the database on persistent **local** storage (not ephemeral container
storage or a shared network filesystem) with restricted access. Do not expose
its directory through static hosting. The UI's existing security controls are
preserved; this change does not add authentication to previously public admin
endpoints.

## Explicit migration (requires approval for real attendance data)

No migration runs automatically. If `attendance_store.json` exists and the
selected database is uninitialized, startup stops with instructions rather
than presenting an empty attendance list. Obtain approval and stop the old
server to obtain a consistent JSON source. Back up the source securely, then
choose a **new, nonexistent** destination:

```sh
npm run migrate:attendance -- /absolute/path/attendance_store.json /persistent/path/imported.sqlite
ATTENDANCE_DB_PATH=/persistent/path/imported.sqlite npm run dev
```

The importer validates legacy structure, records, settings and alerts, preserves
records and history without rewriting their timestamps, and commits the entire
import atomically. It never modifies or deletes the JSON source. The CLI refuses
an existing destination; the storage layer also refuses to import into any
initialized database, even one with no attendance. Invalid input fails without
initializing attendance state. Failed imports may leave an empty SQLite schema;
choose a different new path for a corrected retry. No real attendance migration
or deployment was performed during development.

After an approved import, verify dates, histories, alerts, settings and CSV
exports against the source before switching the production process. Retain the
original source and previous server for rollback; any new check-ins after the
switch must be reconciled before reverting to JSON.

For backups, use SQLite's online backup API or the SQLite CLI `.backup` command.
Alternatively stop all writers and copy the database together with any `-wal`
and `-shm` files. Do not copy only the main database while it is being written.
Test restoration to a separate path and check `PRAGMA integrity_check` before
using a restored copy. Never replace the live database without approval.

Tests use temporary databases and synthetic attendance only. Existing attendance
files are ignored by Git and are never read or migrated by tests.
