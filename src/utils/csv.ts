import { AttendanceRecord, ImagingLeaderboardEntry } from '../types';

export function downloadAttendanceCSV(
  records: AttendanceRecord[],
  dateStr: string,
  _allTimeCounts?: Record<string, number>
) {
  // Column headers
  const headers = [
    'Student Name',
    'Status',
    'Clock In Time',
    'Clock Out Time',
    'Duration',
    'Laptops Imaged (Session)',
    'Flagged Proxy Alert',
    'Flag Reason',
  ];

  const rows = records.map((rec) => {
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
        ? `${(rec.durationMinutes / 60).toFixed(2)} hrs`
        : '';
    const sessionLaptops = rec.laptopsImaged || 0;
    const flagged = rec.isFlagged ? 'YES - REVIEW' : 'No';
    const flagReason = rec.flagReason || '';

    return [
      `"${rec.studentName.replace(/"/g, '""')}"`,
      `"${statusDisplay}"`,
      `"${clockIn}"`,
      `"${clockOut}"`,
      `"${durationDisplay}"`,
      sessionLaptops,
      `"${flagged}"`,
      `"${flagReason.replace(/"/g, '""')}"`,
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `club_attendance_and_laptops_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadLaptopsLeaderboardCSV(
  entries: ImagingLeaderboardEntry[],
  dateStr: string,
  mode: 'session' | 'all-time' | 'total-hours'
) {
  const headers =
    mode === 'total-hours'
      ? [
          'Rank',
          'Student Name',
          'Total Hours Completed',
          'Total Minutes',
          'Sessions Attended',
          'All-Time Laptops Imaged',
          'Current Status',
          'Clock In Time',
        ]
      : [
          'Rank',
          'Student Name',
          mode === 'session' ? 'Session Laptops Imaged' : 'All-Time Laptops Imaged',
          'Total Hours Completed',
          'Status',
          'Clock In Time',
          'Today Duration',
        ];

  const rows = entries.map((entry) => {
    const todayDurationDisplay =
      entry.durationMinutes !== null
        ? `${(entry.durationMinutes / 60).toFixed(2)} hrs`
        : '--';

    const totalHoursDisplay = entry.allTimeHoursFormatted || (
      entry.allTimeMinutes ? `${Math.floor(entry.allTimeMinutes / 60)}h ${entry.allTimeMinutes % 60}m` : '0h 0m'
    );

    if (mode === 'total-hours') {
      return [
        entry.rank,
        `"${entry.studentName.replace(/"/g, '""')}"`,
        `"${totalHoursDisplay}"`,
        entry.allTimeMinutes || 0,
        entry.sessionsAttended || 0,
        entry.allTimeLaptops,
        `"${entry.status}"`,
        `"${entry.clockInTime || '--'}"`,
      ].join(',');
    }

    return [
      entry.rank,
      `"${entry.studentName.replace(/"/g, '""')}"`,
      mode === 'session' ? entry.sessionLaptops : entry.allTimeLaptops,
      `"${totalHoursDisplay}"`,
      `"${entry.status}"`,
      `"${entry.clockInTime || '--'}"`,
      `"${todayDurationDisplay}"`,
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `club_leaderboard_${mode}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
