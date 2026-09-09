import { AttendanceRecord } from '../types';

export function downloadAttendanceCSV(records: AttendanceRecord[], dateStr: string) {
  // Column headers
  const headers = [
    'Student Name',
    'Last Name',
    'First Name',
    'Status',
    'Clock In Time',
    'Clock Out Time',
    'Duration',
    'Duration (Minutes)',
    'Flagged Proxy Alert',
    'Flag Reason',
    'Terminal / Device',
    'Date',
  ];

  const rows = records.map((rec) => {
    const parts = rec.studentName.split(', ');
    const lastName = parts[0] || '';
    const firstName = parts[1] || '';

    const statusDisplay =
      rec.status === 'completed'
        ? 'Clocked Out (Completed)'
        : rec.status === 'checked_in'
        ? 'Present (Active)'
        : 'Absent';

    const clockIn = rec.clockInTime || '';
    const clockOut = rec.clockOutTime || '';
    const durationDisplay =
      rec.durationMinutes !== null
        ? `${Math.floor(rec.durationMinutes / 60)}h ${rec.durationMinutes % 60}m`
        : '';
    const durationMinutes = rec.durationMinutes !== null ? rec.durationMinutes.toString() : '';
    const flagged = rec.isFlagged ? 'YES - REVIEW' : 'No';
    const flagReason = rec.flagReason || '';
    const terminal = rec.checkedInByClientId || '';

    return [
      `"${rec.studentName.replace(/"/g, '""')}"`,
      `"${lastName.replace(/"/g, '""')}"`,
      `"${firstName.replace(/"/g, '""')}"`,
      `"${statusDisplay}"`,
      `"${clockIn}"`,
      `"${clockOut}"`,
      `"${durationDisplay}"`,
      durationMinutes,
      `"${flagged}"`,
      `"${flagReason.replace(/"/g, '""')}"`,
      `"${terminal}"`,
      `"${dateStr}"`,
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `club_attendance_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
