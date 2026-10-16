import type { AttendanceRecord } from '../types';

// Responses for another date are never eligible for display or caching.
export function attendanceMap(date: string, records: AttendanceRecord[]): Record<string, AttendanceRecord> {
  const result: Record<string, AttendanceRecord> = Object.create(null);
  for (const record of records) {
    if (record.date !== date || record.id !== `${date}_${record.studentId}`) throw new Error('Attendance response contains a different date or identity');
    result[record.studentId] = record;
  }
  return result;
}
export function canCheckIn(record?: AttendanceRecord) { return record?.status !== 'checked_in'; }
