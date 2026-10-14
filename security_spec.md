# Security Specification & Threat Model

## 1. Data Invariants
- **Identity & Format Invariant**: Document IDs must be alphanumeric strings with hyphens/underscores, maximum 128 chars (`isValidId`).
- **Integrity Invariant**: Attendance records require valid student ID, student name, session date in `YYYY-MM-DD` format, and valid status (`absent`, `checked_in`, `completed`).
- **Bounded Size Invariant**: All strings are bounded in size (`<= 128` chars for names/ids, `<= 256` for flag reasons, `<= 500` for alert messages) to prevent resource exhaustion attacks.
- **State Validity Invariant**: Students cannot inject negative laptop counts or invalid statuses.
- **Admin & Audit Protection**: Catch-all default deny on all unspecified paths to prevent unauthorized reads/writes.

## 2. The Dirty Dozen Payloads (Designed to Break Identity, Integrity, and State)
1. **Oversized Record ID Attack**: Payload with a 10KB string ID targeting `/attendance_records/{oversizedId}`.
2. **Path Traversal / Special Char Injection**: ID containing `../admin/secret` or script tags.
3. **Ghost Field Injection**: Adding `{ isRootAdmin: true }` to attendance record update.
4. **Negative Laptops Attack**: Writing `{ laptopsImaged: -50 }` to distort leaderboard.
5. **Invalid Attendance Status Attack**: Setting `status: "super_admin_verified"`.
6. **Corrupt Date Format Attack**: Setting `date: "yesterday-or-hack"`.
7. **Name Poisoning Attack**: Submitting 5MB string in `studentName` field.
8. **Direct Settings Tampering by Untrusted Client**: Attempting unauthenticated overwrite of `/settings/config`.
9. **Fake Alert Fabrication**: Submitting arbitrary alerts with unapproved types.
10. **Orphaned Record Creation**: Creating an attendance record with empty `studentId` or missing required fields.
11. **Negative Timestamp Attack**: Providing invalid or malformed timestamps.
12. **Catch-All Probe Attack**: Reading or writing to undeclared collections such as `/system_secrets/keys`.

## 3. Test Runner
See `firestore.rules.test.ts` for unit assertions verifying that all Dirty Dozen test payloads are rejected.
