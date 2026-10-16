import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { AttendanceDatabase } from '../storage.ts';
import { CLUB_ROSTER } from '../src/data/roster.ts';
import { AttendanceRecord, Student } from '../src/types.ts';

// Helper to parse CSV lines cleanly handling quotes
function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur.replace(/^"|"$/g, '').trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.replace(/^"|"$/g, '').trim());
  return result;
}

function parseDurationToMinutes(durStr: string): number | null {
  if (!durStr) return null;
  const match = durStr.match(/([\d.]+)\s*hrs?/i);
  if (match) {
    return Math.round(parseFloat(match[1]) * 60);
  }
  return null;
}

function parseTimeToTimestamp(dateStr: string, timeStr: string): number | null {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const [y, m, d] = dateStr.split('-').map(Number);
  // Pacific time approximation
  return Date.UTC(y, m - 1, d, hour + 7, minute, second);
}

// Map student name to ID in CLUB_ROSTER
const nameToStudentMap = new Map<string, Student>();
for (const s of CLUB_ROSTER) {
  nameToStudentMap.set(s.name.toLowerCase().trim(), s);
  nameToStudentMap.set(`${s.lastName.toLowerCase().trim()}, ${s.firstName.toLowerCase().trim()}`, s);
}

function findStudent(name: string): Student | null {
  const clean = name.toLowerCase().trim();
  if (nameToStudentMap.has(clean)) return nameToStudentMap.get(clean)!;
  // Partial search
  for (const [k, v] of nameToStudentMap.entries()) {
    if (clean.includes(v.lastName.toLowerCase()) && clean.includes(v.firstName.toLowerCase())) {
      return v;
    }
  }
  return null;
}

export function parseCsvIntoDayRecords(dateStr: string, csvContent: string): Record<string, AttendanceRecord> {
  const lines = csvContent.trim().split(/\r?\n/).filter(Boolean);
  const dayRecords: Record<string, AttendanceRecord> = Object.create(null);

  // Initialize absent records for all CLUB_ROSTER students
  for (const s of CLUB_ROSTER) {
    dayRecords[s.id] = {
      id: `${dateStr}_${s.id}`,
      date: dateStr,
      studentId: s.id,
      studentName: s.name,
      clockInTime: null,
      clockInTimestamp: null,
      clockOutTime: null,
      clockOutTimestamp: null,
      durationMinutes: null,
      status: 'absent',
      checkedInByClientId: null,
      checkedOutByClientId: null,
      isFlagged: false,
      laptopsImaged: 0,
      history: [],
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 2) continue;
    const [name, statusRaw, inTime, outTime, durStr, laptopsRaw, flagRaw, flagReason] = row;
    const student = findStudent(name);
    if (!student) {
      console.warn(`Student not found for name: "${name}" on date ${dateStr}`);
      continue;
    }

    const sId = student.id;
    const isCompleted = statusRaw.toLowerCase().includes('completed') || statusRaw.toLowerCase().includes('clocked out');
    const isPresent = statusRaw.toLowerCase().includes('present') || statusRaw.toLowerCase().includes('active');

    const durationMinutes = parseDurationToMinutes(durStr);
    const inTs = parseTimeToTimestamp(dateStr, inTime);
    const outTs = parseTimeToTimestamp(dateStr, outTime);
    const laptops = parseInt(laptopsRaw, 10) || 0;
    const isFlagged = Boolean(flagRaw && (flagRaw.toUpperCase().includes('YES') || flagRaw.toUpperCase().includes('REVIEW')));

    dayRecords[sId] = {
      id: `${dateStr}_${sId}`,
      date: dateStr,
      studentId: sId,
      studentName: student.name,
      clockInTime: inTime || null,
      clockInTimestamp: inTs,
      clockOutTime: outTime || null,
      clockOutTimestamp: outTs,
      durationMinutes: durationMinutes !== null ? durationMinutes : (inTs && outTs ? Math.round((outTs - inTs) / 60000) : null),
      status: isCompleted ? 'completed' : isPresent ? 'checked_in' : 'absent',
      checkedInByClientId: inTime ? 'admin_panel' : null,
      checkedOutByClientId: outTime ? 'admin_panel' : null,
      isFlagged,
      flagReason: flagReason || undefined,
      laptopsImaged: laptops,
      history: inTime ? [
        { action: 'check_in', timestamp: inTs || 0, timeFormatted: inTime, clientId: 'admin_panel' },
        ...(outTime ? [{ action: 'check_out' as const, timestamp: outTs || 0, timeFormatted: outTime, clientId: 'admin_panel' }] : [])
      ] : [],
    };
  }

  return dayRecords;
}

// 10/12 canonical records (21 volunteers including Gio Hua)
export const RECORDS_10_12 = [
  { name: 'Anderson-Smith, Anna', in: '03:04 PM', out: '04:32 PM', dur: 88, laptops: 2 },
  { name: 'Arakawa, Sota', in: '03:02 PM', out: '04:40 PM', dur: 98, laptops: 4 },
  { name: 'Bharadwaj, Vedavit', in: '03:09 PM', out: '04:35 PM', dur: 86, laptops: 2 },
  { name: 'Deniel, Enzo', in: '03:05 PM', out: '04:42 PM', dur: 97, laptops: 3 },
  { name: 'Gu, Noah', in: '03:14 PM', out: '04:30 PM', dur: 76, laptops: 2 },
  { name: 'Hanif, Ela', in: '03:10 PM', out: '04:38 PM', dur: 87, laptops: 2 },
  { name: 'Hua, Gio', in: '03:00 PM', out: '04:15 PM', dur: 75, laptops: 0 },
  { name: 'Kosau, Michael', in: '03:12 PM', out: '04:35 PM', dur: 83, laptops: 2 },
  { name: 'Lee, Caleb', in: '03:08 PM', out: '04:35 PM', dur: 87, laptops: 2 },
  { name: 'Liang, Kaydan', in: '03:16 PM', out: '04:30 PM', dur: 74, laptops: 1 },
  { name: 'Liu, Felicia', in: '03:00 PM', out: '04:45 PM', dur: 105, laptops: 5 },
  { name: 'Ly, Benjamin', in: '03:12 PM', out: '04:30 PM', dur: 78, laptops: 2 },
  { name: 'Min, Daniel', in: '03:15 PM', out: '04:38 PM', dur: 83, laptops: 2 },
  { name: 'Myslinski, Nicholas', in: '03:10 PM', out: '04:40 PM', dur: 90, laptops: 3 },
  { name: 'Neogy, Aviran', in: '03:06 PM', out: '04:35 PM', dur: 89, laptops: 2 },
  { name: 'Nikiforov, Maksim', in: '03:18 PM', out: '04:25 PM', dur: 67, laptops: 1 },
  { name: 'Norgaard, Ava', in: '02:50 PM', out: '05:00 PM', dur: 130, laptops: 3 },
  { name: 'Sakchalathorn, Cruz', in: '03:15 PM', out: '04:28 PM', dur: 73, laptops: 1 },
  { name: 'Taticherla, Sameer', in: '03:11 PM', out: '04:30 PM', dur: 79, laptops: 1 },
  { name: 'Tsai, Aron', in: '03:13 PM', out: '04:35 PM', dur: 82, laptops: 2 },
  { name: 'Xia, Eric', in: '03:07 PM', out: '04:36 PM', dur: 89, laptops: 2 },
];

export function build1012Records(dateStr: string): Record<string, AttendanceRecord> {
  const dayRecords: Record<string, AttendanceRecord> = Object.create(null);
  for (const s of CLUB_ROSTER) {
    dayRecords[s.id] = {
      id: `${dateStr}_${s.id}`,
      date: dateStr,
      studentId: s.id,
      studentName: s.name,
      clockInTime: null,
      clockInTimestamp: null,
      clockOutTime: null,
      clockOutTimestamp: null,
      durationMinutes: null,
      status: 'absent',
      checkedInByClientId: null,
      checkedOutByClientId: null,
      isFlagged: false,
      laptopsImaged: 0,
      history: [],
    };
  }

  for (const item of RECORDS_10_12) {
    const student = findStudent(item.name);
    if (!student) continue;
    const inTs = parseTimeToTimestamp(dateStr, item.in);
    const outTs = parseTimeToTimestamp(dateStr, item.out);
    dayRecords[student.id] = {
      id: `${dateStr}_${student.id}`,
      date: dateStr,
      studentId: student.id,
      studentName: student.name,
      clockInTime: item.in,
      clockInTimestamp: inTs,
      clockOutTime: item.out,
      clockOutTimestamp: outTs,
      durationMinutes: item.dur,
      status: 'completed',
      checkedInByClientId: 'admin_panel',
      checkedOutByClientId: 'admin_panel',
      isFlagged: false,
      laptopsImaged: item.laptops,
      history: [
        { action: 'check_in', timestamp: inTs || 0, timeFormatted: item.in, clientId: 'admin_panel' },
        { action: 'check_out', timestamp: outTs || 0, timeFormatted: item.out, clientId: 'admin_panel' },
      ],
    };
  }

  return dayRecords;
}
