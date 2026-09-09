export interface Student {
  id: string;
  name: string; // "Last, First"
  lastName: string;
  firstName: string;
}

export type AttendanceStatus = 'absent' | 'checked_in' | 'completed';

export interface AttendanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  studentId: string;
  studentName: string;
  clockInTime: string | null;
  clockInTimestamp: number | null;
  clockOutTime: string | null;
  clockOutTimestamp: number | null;
  durationMinutes: number | null;
  status: AttendanceStatus;
  checkedInByClientId: string | null;
  checkedOutByClientId: string | null;
  isFlagged: boolean;
  flagReason?: string;
  history?: Array<{
    action: 'check_in' | 'check_out' | 'reset';
    timestamp: number;
    timeFormatted: string;
    clientId: string;
  }>;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface SecurityAlert {
  id: string;
  timestamp: number;
  date: string;
  timeFormatted: string;
  type: 'RAPID_CHECKIN' | 'DEVICE_REUSE' | 'UNUSUAL_ACTION';
  severity: AlertSeverity;
  currentStudent: string;
  previousStudent?: string;
  timeDiffSeconds?: number;
  clientId: string;
  message: string;
  acknowledged: boolean;
}

export interface AttendanceSummary {
  totalStudents: number;
  checkedInCount: number;
  completedCount: number;
  absentCount: number;
  flaggedCount: number;
  unreadAlertsCount: number;
}

export interface SecuritySettings {
  rapidThresholdSeconds: number; // e.g. 15 or 30 seconds
  strictMode: boolean; // if true, block 2nd checkin within threshold
  soundAlerts: boolean;
  kioskMode: boolean; // if true, clear focus and ready for next member
}
