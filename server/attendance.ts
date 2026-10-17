import type { AttendanceRecord, Student } from '../src/types.ts';
import type { StoreData } from '../storage.ts';
import { CLUB_ROSTER } from '../src/data/roster.ts';
export const ZONE = 'America/Los_Angeles';
export function today(now: number) { return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function time(now: number) { return new Date(now).toLocaleTimeString('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }); }
export function minuteOfDay(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
}
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}
export function roster(store: StoreData): Student[] {
  return [...new Map([...CLUB_ROSTER, ...(store.customStudents || [])].map(s => [s.id, s])).values()];
}
export function blank(date: string, student: Student): AttendanceRecord {
  return { id: `${date}_${student.id}`, date, studentId: student.id, studentName: student.name,
    clockInTime: null, clockInTimestamp: null, clockOutTime: null, clockOutTimestamp: null,
    durationMinutes: null, status: 'absent', checkedInByClientId: null, checkedOutByClientId: null,
    isFlagged: false, laptopsImaged: 0, laptopLogs: [], history: [] };
}
export function dayRecords(store: StoreData, date: string) {
  const existing = store.recordsByDate[date] || {};
  return roster(store).map(s => existing[s.id] || blank(date, s));
}
export function recordFor(store: StoreData, date: string, id: string): AttendanceRecord {
  if (!roster(store).some(s => s.id === id)) throw new ApiError(404, 'Student not found in roster');
  store.recordsByDate[date] ||= Object.create(null);
  return store.recordsByDate[date][id] ||= blank(date, roster(store).find(s => s.id === id)!);
}
export function history(record: AttendanceRecord, action: NonNullable<AttendanceRecord['history']>[number]['action'], now: number, clientId: string) {
  (record.history ||= []).push({ action, timestamp: now, timeFormatted: time(now), clientId });
  record.revision = (record.revision || 0) + 1;
}
export function checkIn(record: AttendanceRecord, now: number, clientId: string) {
  if (record.status === 'checked_in') return; // Duplicate clicks/retries never rewrite arrival or append history.
  record.completedSessionMinutes = record.status === 'completed' ? (record.durationMinutes || 0) : (record.completedSessionMinutes || 0);
  record.clockInTime = time(now); record.clockInTimestamp = now;
  record.clockOutTime = null; record.clockOutTimestamp = null; record.checkedOutByClientId = null;
  record.durationMinutes = record.completedSessionMinutes || null;
  record.status = 'checked_in'; record.checkedInByClientId = clientId;
  for (const key of ['actualCheckoutTime','cutoffExceeded','post415Exceeded','lateCheckoutTier','exceptionGranted','exceptionApprovedTime','exceptionNote']) delete record[key];
  history(record, 'check_in', now, clientId);
}
export function checkOut(record: AttendanceRecord, now: number, clientId: string) {
  if (record.status === 'completed') return;
  if (record.status !== 'checked_in' || !record.clockInTimestamp) throw new ApiError(400, 'Student must check in before checking out');
  const minutes = minuteOfDay(now);
  const cutoffNow = minutes > 16 * 60 + 45 ? now - (minutes - (16 * 60 + 45)) * 60_000 - new Date(now).getSeconds() * 1000 : now;
  const end = Math.max(record.clockInTimestamp, cutoffNow);
  record.clockOutTime = time(end); record.clockOutTimestamp = end;
  record.durationMinutes = (record.completedSessionMinutes || 0) + Math.max(0, Math.round((end - record.clockInTimestamp) / 60_000));
  record.status = 'completed'; record.checkedOutByClientId = clientId;
  record.post415Exceeded = minutes > 16 * 60 + 15;
  record.cutoffExceeded = minutes > 16 * 60 + 45;
  if (record.cutoffExceeded) { record.actualCheckoutTime = time(now); record.lateCheckoutTier = 'post_445'; }
  else if (record.post415Exceeded) record.lateCheckoutTier = 'post_415';
  history(record, 'check_out', now, clientId);
}
