export interface Student {
  id: string;
  name: string; // "Last, First"
  lastName: string;
  firstName: string;
}

export type AttendanceStatus = 'absent' | 'checked_in' | 'completed';

export interface LaptopImageLog {
  id: string;
  timestamp: number;
  timeFormatted: string;
  count: number;
  model?: string;
  assetTag?: string;
  notes?: string;
}

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
  laptopsImaged?: number; // Number of laptops imaged in this session
  laptopLogs?: LaptopImageLog[]; // Detailed log of imaged laptops
  actualCheckoutTime?: string; // Original attempted checkout time if after 4:45 PM
  cutoffExceeded?: boolean; // True if student attempted checkout past 4:45 PM
  post415Exceeded?: boolean; // True if student checked out between 4:15 PM and 4:45 PM
  lateCheckoutTier?: 'post_415' | 'post_445'; // Cutoff tier: post_415 (yellow warning) or post_445 (red critical)
  exceptionGranted?: boolean; // True if admin approved exception past 4:45 PM
  exceptionApprovedTime?: string; // Time approved by admin
  exceptionNote?: string; // Note from admin regarding exception
  history?: Array<{
    action: 'check_in' | 'check_out' | 'reset' | 'laptop_update' | 'exception_grant';
    timestamp: number;
    timeFormatted: string;
    clientId: string;
  }>;
}

export interface ClubGoalSettings {
  targetLaptops: number; // e.g. 250
  sessionTarget: number; // e.g. 30
}

export interface ImagingLeaderboardEntry {
  studentId: string;
  studentName: string;
  lastName: string;
  firstName: string;
  sessionLaptops: number;
  allTimeLaptops: number;
  allTimeMinutes?: number;
  allTimeHoursFormatted?: string;
  allTimeHoursDecimal?: number;
  sessionsAttended?: number;
  status: AttendanceStatus;
  clockInTime: string | null;
  durationMinutes: number | null;
  rank: number;
}

export interface OverallImagingSummary {
  sessionTotal: number;
  allTimeTotal: number;
  targetLaptops: number;
  sessionTarget: number;
  clubGoal?: ClubGoalSettings;
  topStudentSession: { name: string; count: number } | null;
  topStudentAllTime: { name: string; count: number } | null;
  topStudentHours?: { name: string; minutes: number; formatted: string } | null;
  allTimeTotalClubMinutes?: number;
  allTimeTotalClubHours?: number;
  activeImagersSessionCount: number;
  totalMembersCount: number;
  sessionLeaderboard?: ImagingLeaderboardEntry[];
  allTimeLeaderboard?: ImagingLeaderboardEntry[];
  allTimeHoursLeaderboard?: ImagingLeaderboardEntry[];
  allTimeHoursMap?: Record<string, number>;
  allTimeSessionsMap?: Record<string, number>;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface SecurityAlert {
  id: string;
  timestamp: number;
  date: string;
  timeFormatted: string;
  type: 'DEVICE_REUSE' | 'UNUSUAL_ACTION' | 'LATE_CHECKOUT' | 'POST_415_CHECKOUT' | 'RAPID_CHECKIN';
  severity: AlertSeverity;
  currentStudent: string;
  studentId?: string;
  attemptedTime?: string;
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
  rapidThresholdSeconds?: number;
  strictMode: boolean; // if true, block 2nd checkin within threshold
  soundAlerts: boolean;
  kioskMode: boolean; // if true, clear focus and ready for next member
}
