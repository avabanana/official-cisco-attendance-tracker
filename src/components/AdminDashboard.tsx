import React, { useState, useMemo } from 'react';
import {
  Download,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Users,
  Clock,
  Settings,
  Bell,
  RotateCcw,
  Edit2,
  Search,
  Check,
  Trash2,
  Activity,
  Sliders,
  Laptop,
  Trophy,
  Plus,
  Minus,
  ChevronRight,
  Lock,
  ShieldCheck,
  FileText,
  UserPlus,
  LogIn,
  LogOut,
  Cloud,
  Database,
  RefreshCw,
  Mail,
  Send,
  CalendarClock,
  ExternalLink,
} from 'lucide-react';
import { AttendanceRecord, OverallImagingSummary, SecurityAlert, SecuritySettings, Student } from '../types';
import { downloadAttendanceCSV } from '../utils/csv';
import { EditRecordModal } from './EditRecordModal';
import { CutoffExceptionModal } from './CutoffExceptionModal';
import { LogLaptopModal } from './LogLaptopModal';
import { AddVolunteerModal } from './AddVolunteerModal';
import { getFriendlyClientId } from '../utils/clientId';
import { useFirebase } from '../context/FirebaseContext';

interface AdminDashboardProps {
  getAdminHeaders: () => Record<string, string>;
  roster: Student[];
  recordsMap: Record<string, AttendanceRecord>;
  alerts: SecurityAlert[];
  settings: SecuritySettings;
  onUpdateSettings: (newSettings: Partial<SecuritySettings>) => Promise<void>;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onClearAlerts: () => Promise<void>;
  onResetStudent: (studentId: string) => Promise<void>;
  onCheckIn: (studentId: string) => Promise<void>;
  onCheckOut: (studentId: string) => Promise<void>;
  loadingStates?: Record<string, boolean>;
  onAdjustRecord: (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
    laptopsImaged?: number;
  }) => Promise<void>;
  onSimulateTestAlert: () => void;
  selectedDate: string;
  onUpdateLaptops?: (params: {
    studentId: string;
    delta?: number;
    setCount?: number;
    log?: {
      model?: string;
      assetTag?: string;
      notes?: string;
      count?: number;
    };
  }) => Promise<void>;
  summary?: OverallImagingSummary | null;
  allTimeCounts?: Record<string, number>;
  onNavigateToLeaderboard?: () => void;
  onLockAdmin?: () => void;
  onResetDayClick?: () => void;
  onResetAllDataClick?: () => void;
  onApproveCutoffException?: (params: {
    studentId: string;
    actualTime: string;
    notes?: string;
  }) => Promise<void>;
  onAddVolunteer?: (data: {
    firstName: string;
    lastName: string;
    clockInNow?: boolean;
  }) => Promise<void>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  roster,
  recordsMap,
  alerts,
  settings,
  onUpdateSettings,
  onAcknowledgeAlert,
  onClearAlerts,
  onResetStudent,
  onCheckIn,
  getAdminHeaders,
  onCheckOut,
  loadingStates = {},
  onAdjustRecord,
  onSimulateTestAlert,
  selectedDate,
  onUpdateLaptops,
  summary,
  allTimeCounts,
  onNavigateToLeaderboard,
  onLockAdmin,
  onResetDayClick,
  onResetAllDataClick,
  onApproveCutoffException,
  onAddVolunteer,
}) => {
  const [tableSearch, setTableSearch] = useState('');
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [exceptionRecord, setExceptionRecord] = useState<AttendanceRecord | null>(null);
  const [selectedStudentForLog, setSelectedStudentForLog] = useState<Student | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [isAddVolunteerOpen, setIsAddVolunteerOpen] = useState(false);

  const {
    user,
    isAdmin: isFirebaseAdmin,
    isFirebaseAvailable,
    isSyncing,
    lastSyncedAt,
    signInWithGoogle,
    logOut,
    syncFullStoreToFirestore,
  } = useFirebase();
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // Automated 5:00 PM Email State & Handlers
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSendResult, setEmailSendResult] = useState<{
    success: boolean;
    message: string;
    log?: any;
  } | null>(null);
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [showEmailLogs, setShowEmailLogs] = useState(false);

  const loadEmailStatus = async () => {
    try {
      const res = await fetch('/api/email/status');
      if (res.ok) {
        const data = await res.json();
        setEmailStatus(data);
      }
    } catch {}
  };

  React.useEffect(() => {
    loadEmailStatus();
  }, [selectedDate]);

  const handleSendEmailNow = async () => {
    setIsSendingEmail(true);
    setEmailSendResult(null);
    try {
      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ date: selectedDate }),
      });
      const data = await res.json();
      if (res.ok) {
        setEmailSendResult({
          success: true,
          message: data.message || `Spreadsheet email dispatched to avasophianorgaard@gmail.com!`,
          log: data.log,
        });
        loadEmailStatus();
      } else {
        setEmailSendResult({
          success: false,
          message: data.error || 'Failed to dispatch email',
        });
      }
    } catch (err: any) {
      setEmailSendResult({
        success: false,
        message: err.message || 'Network error sending email',
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleOpenGmailClient = () => {
    const recordsList = roster.map((s) => recordsMap[s.id]).filter(Boolean);
    const active = recordsList.filter((r) => r.clockInTime || (r.laptopsImaged && r.laptopsImaged > 0));
    const completed = recordsList.filter((r) => r.status === 'completed');
    const totalMinutes = recordsList.reduce((acc, r) => acc + (r.durationMinutes || 0), 0);
    const totalLaptops = recordsList.reduce((acc, r) => acc + (r.laptopsImaged || 0), 0);

    const subject = encodeURIComponent(`Completed Attendance & Laptop Imaging Spreadsheet - ${selectedDate}`);
    const body = encodeURIComponent(
      `Hello Ava,\n\nHere is the completed daily club session attendance and laptop spreadsheet for ${selectedDate}:\n\n` +
      `• Total Members Attended: ${active.length}\n` +
      `• Members Completed/Clocked Out: ${completed.length}\n` +
      `• Total Volunteer Hours: ${(totalMinutes / 60).toFixed(2)} hrs\n` +
      `• Total Laptops Imaged: ${totalLaptops}\n\n` +
      `The full completed spreadsheet has been generated and saved to the club archives (sheets/${selectedDate}.csv).\n\n` +
      `Best regards,\nClub Attendance & Laptop Imaging System`
    );

    window.open(`mailto:avasophianorgaard@gmail.com?subject=${subject}&body=${body}`, '_blank');
  };

  const handleSyncFirebase = async () => {
    setSyncStatusMsg(null);
    const result = await syncFullStoreToFirestore();
    if (result.success) {
      setSyncStatusMsg(`Verified ${result.count} records in the authoritative Firestore database. No records were uploaded or changed.`);
    } else {
      setSyncStatusMsg(result.error || 'Sync failed');
    }
  };

  // Compute metrics
  const stats = useMemo(() => {
    let present = 0;
    let completed = 0;
    let absent = 0;
    let flagged = 0;
    let laptopsToday = 0;

    for (const s of roster) {
      const rec = recordsMap[s.id];
      if (rec?.isFlagged) flagged++;
      if (rec?.status === 'checked_in') present++;
      else if (rec?.status === 'completed') completed++;
      else absent++;
      laptopsToday += rec?.laptopsImaged || 0;
    }

    const unacknowledgedAlerts = alerts.filter((a) => !a.acknowledged).length;

    return {
      total: roster.length,
      present,
      completed,
      absent,
      flagged,
      laptopsToday,
      unacknowledgedAlerts,
    };
  }, [roster, recordsMap, alerts]);

  // Filtered table records
  const filteredRecords = useMemo(() => {
    return roster.filter((student) => {
      if (!tableSearch.trim()) return true;
      const q = tableSearch.toLowerCase().trim();
      return (
        student.name.toLowerCase().includes(q) ||
        student.lastName.toLowerCase().includes(q) ||
        student.firstName.toLowerCase().includes(q)
      );
    });
  }, [roster, tableSearch]);

  const handleExportCSV = () => {
    const recordsList = roster.map((s) => recordsMap[s.id]).filter(Boolean);
    downloadAttendanceCSV(recordsList, selectedDate, allTimeCounts);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                Club Administration
              </span>
              <span className="text-xs text-slate-500">
                Session: {selectedDate}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Attendance & Anti-Proxy Monitoring
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mt-0.5">
              Live monitor for club check-ins, checkout cut-off adherence, and device integrity.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              id="btn-settings-toggle"
              onClick={() => setShowSettingsPanel(!showSettingsPanel)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                showSettingsPanel
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Proxy Rules</span>
            </button>

            <button
              id="btn-export-csv"
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export Attendance CSV</span>
            </button>

            <button
              id="btn-admin-email-spreadsheet"
              onClick={handleSendEmailNow}
              disabled={isSendingEmail}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
              title="Send completed daily spreadsheet email to avasophianorgaard@gmail.com"
            >
              <Mail className="w-4 h-4" />
              <span>{isSendingEmail ? 'Sending Email...' : 'Email Daily Spreadsheet'}</span>
            </button>

            {onAddVolunteer && (
              <button
                id="btn-admin-add-volunteer"
                type="button"
                onClick={() => setIsAddVolunteerOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
                title="Add a new student volunteer to the club roster"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Volunteer</span>
              </button>
            )}

            {onResetDayClick && (
              <button
                id="btn-admin-reset-day"
                type="button"
                onClick={onResetDayClick}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 active:scale-[0.98] text-rose-700 hover:text-rose-800 rounded-xl text-xs font-semibold border border-rose-200 hover:border-rose-300 shadow-2xs transition-all cursor-pointer"
                title={`Reset all attendance and laptop records across ${selectedDate}`}
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                <span>Reset Day Records</span>
              </button>
            )}

            {onResetAllDataClick && (
              <button
                id="btn-admin-reset-all"
                type="button"
                onClick={onResetAllDataClick}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                title="Completely reset all site data, including all-time laptops imaged, logs, and all historical dates"
              >
                <Trash2 className="w-3.5 h-3.5 text-white" />
                <span>Reset All Site Data</span>
              </button>
            )}

            {onLockAdmin && (
              <button
                id="btn-lock-admin"
                onClick={onLockAdmin}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 rounded-xl text-xs font-medium border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer"
                title="Lock admin dashboard"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-5 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Club Roster</span>
              <Users className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-slate-900">{stats.total}</div>
            <div className="text-[11px] text-slate-500">Registered members</div>
          </div>

          <div className="bg-emerald-50/70 rounded-xl p-3.5 border border-emerald-100">
            <div className="flex items-center justify-between text-emerald-700 mb-1">
              <span className="text-xs font-medium">Present Now</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <div className="text-xl font-bold text-emerald-800">{stats.present}</div>
            <div className="text-[11px] text-emerald-700">Currently in room</div>
          </div>

          <div className="bg-indigo-50/70 rounded-xl p-3.5 border border-indigo-100">
            <div className="flex items-center justify-between text-indigo-700 mb-1">
              <span className="text-xs font-medium">Clocked Out</span>
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-indigo-800">{stats.completed}</div>
            <div className="text-[11px] text-indigo-700">Departed with record</div>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Not Arrived</span>
              <Clock className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-slate-700">{stats.absent}</div>
            <div className="text-[11px] text-slate-500">Unchecked members</div>
          </div>

          {/* Laptops Imaged Card */}
          <div
            onClick={onNavigateToLeaderboard}
            className={`rounded-xl p-3.5 border transition-all cursor-pointer bg-indigo-50/70 border-indigo-100 hover:border-indigo-300 hover:bg-indigo-100/50 group`}
            title="Click to view laptop leaderboard & progress"
          >
            <div className="flex items-center justify-between text-indigo-700 mb-1">
              <span className="text-xs font-medium flex items-center gap-1">
                <Laptop className="w-3.5 h-3.5 text-indigo-600" />
                Laptops Today
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-700 transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="text-xl font-bold text-indigo-900">{stats.laptopsToday}</div>
            <div className="text-[11px] text-indigo-600 font-medium truncate">
              {summary?.topStudentSession ? `Leader: ${summary.topStudentSession.name.split(',')[0]}` : 'Track imaging'}
            </div>
          </div>

          <div
            className={`rounded-xl p-3.5 border transition-all ${
              stats.unacknowledgedAlerts > 0
                ? 'bg-rose-50 border-rose-200'
                : stats.flagged > 0
                ? 'bg-amber-50 border-amber-200'
                : 'bg-slate-50 border-slate-100'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-xs font-medium ${
                  stats.unacknowledgedAlerts > 0
                    ? 'text-rose-700'
                    : stats.flagged > 0
                    ? 'text-amber-700'
                    : 'text-slate-500'
                }`}
              >
                Proxy Alerts
              </span>
              <ShieldAlert
                className={`w-3.5 h-3.5 ${
                  stats.unacknowledgedAlerts > 0 ? 'text-rose-600 animate-bounce' : 'text-slate-400'
                }`}
              />
            </div>
            <div
              className={`text-xl font-bold ${
                stats.unacknowledgedAlerts > 0
                  ? 'text-rose-700'
                  : stats.flagged > 0
                  ? 'text-amber-700'
                  : 'text-slate-900'
              }`}
            >
              {stats.unacknowledgedAlerts}
            </div>
            <div className="text-[11px] text-slate-500">
              {stats.flagged} flagged total
            </div>
          </div>
        </div>

        {/* Firebase Cloud Retention & Database Card */}
        <div className="mt-5 p-4 rounded-xl bg-gradient-to-r from-indigo-900 to-slate-900 text-white border border-indigo-700/50 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  <Database className="w-4 h-4" />
                </div>
                <h4 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                  Firebase Cloud Backend & Data Retention
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    {isFirebaseAvailable ? 'Verified' : 'Unverified'}
                  </span>
                </h4>
              </div>
              <p className="text-xs text-indigo-200/80 max-w-2xl">
                Attendance is saved through server transactions. Use Verify Firebase Storage to check the current database connection; this does not upload or change records.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-300 font-mono">
                <span>Database: <strong className="text-white font-mono">ai-studio-clubattendancetr-...</strong></span>
                <span>•</span>
                <span>Project: <strong className="text-white font-mono">hale-emitter-qxjsq</strong></span>
                {lastSyncedAt && (
                  <>
                    <span>•</span>
                    <span className="text-indigo-200">Last Verified: {lastSyncedAt.toLocaleTimeString()}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {user ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-indigo-200">
                    Admin: <strong className="text-white font-medium">{user.email}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={logOut}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer"
                  title="Optional Google sign-in; attendance is saved by the server"
                >
                  <LogIn className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Sign In with Google</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSyncFirebase}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-500 hover:bg-indigo-600 active:scale-[0.98] disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Verifying...' : 'Verify Firebase Storage'}</span>
              </button>
            </div>
          </div>

          {syncStatusMsg && (
            <div className="mt-3 text-xs px-3 py-1.5 bg-indigo-950/80 border border-indigo-500/30 rounded-lg text-indigo-200 animate-in fade-in">
              {syncStatusMsg}
            </div>
          )}
        </div>

        {/* Daily Spreadsheet Export System */}
        <div className="mt-5 p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white border border-indigo-700/60 shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  <Mail className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      Daily Spreadsheet Export
                    </h3>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Email not configured
                    </span>
                  </div>
                  <p className="text-xs text-indigo-200/90 mt-0.5">
                    Target Recipient:{' '}
                    <strong className="text-white font-mono bg-indigo-900/60 px-1.5 py-0.5 rounded border border-indigo-700/60">
                      avasophianorgaard@gmail.com
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-indigo-200/80 pt-1">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CalendarClock className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                  <strong>Schedule:</strong> 5:00 PM Pacific every weekday (Mon, Tue, Thu, Fri — Wed excluded)
                </span>
                <span>•</span>
                <span>
                  <strong>Selected Session:</strong> {selectedDate} ({stats.present + stats.completed} attended, {stats.completed} clocked out, {stats.laptopsToday} laptops)
                </span>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                id="btn-send-email-now"
                onClick={handleSendEmailNow}
                disabled={isSendingEmail}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
                title={`Send completed spreadsheet email for ${selectedDate} to avasophianorgaard@gmail.com`}
              >
                <Send className={`w-3.5 h-3.5 ${isSendingEmail ? 'animate-pulse' : ''}`} />
                <span>{isSendingEmail ? 'Sending Email...' : 'Send Today\'s Email Now'}</span>
              </button>

              <button
                type="button"
                id="btn-open-gmail-client"
                onClick={handleOpenGmailClient}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
                title="Open Gmail or default email client with completed summary pre-filled"
              >
                <ExternalLink className="w-3.5 h-3.5 text-indigo-300" />
                <span>Open in Gmail</span>
              </button>

              <button
                type="button"
                id="btn-download-session-csv"
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
                title="Download the exact spreadsheet CSV that is sent in the daily email"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download CSV</span>
              </button>

              {emailStatus?.logs && emailStatus.logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowEmailLogs(!showEmailLogs)}
                  className="px-2.5 py-2 text-xs font-medium text-indigo-300 hover:text-white transition-colors cursor-pointer"
                >
                  {showEmailLogs ? 'Hide History' : `History (${emailStatus.logs.length})`}
                </button>
              )}
            </div>
          </div>

          {/* Feedback Banner */}
          {emailSendResult && (
            <div
              className={`mt-4 p-3 rounded-xl border text-xs flex items-center justify-between gap-3 animate-in fade-in ${
                emailSendResult.success
                  ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/80 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{emailSendResult.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setEmailSendResult(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Email Logs Table */}
          {showEmailLogs && emailStatus?.logs && (
            <div className="mt-4 pt-4 border-t border-indigo-800/60 space-y-2 animate-in fade-in">
              <h5 className="text-xs font-bold text-indigo-200 uppercase tracking-wider">
                Recent Automated & Manual Email Dispatches
              </h5>
              <div className="overflow-x-auto rounded-xl border border-indigo-900/60 bg-slate-950/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-indigo-950/80 text-indigo-300 border-b border-indigo-800/40">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Recipient</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Method</th>
                      <th className="py-2 px-3">Volunteers</th>
                      <th className="py-2 px-3">Laptops</th>
                      <th className="py-2 px-3">Dispatched Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-950/40 text-slate-300">
                    {emailStatus.logs.slice(0, 5).map((log: any) => (
                      <tr key={log.id} className="hover:bg-indigo-900/20">
                        <td className="py-2 px-3 font-mono font-medium text-white">{log.dateStr}</td>
                        <td className="py-2 px-3 font-mono text-indigo-200">{log.recipient}</td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold text-[10px]">
                            Sent
                          </span>
                        </td>
                        <td className="py-2 px-3 capitalize text-slate-400">{log.method.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-3 font-mono">{log.activeCount || log.recordCount}</td>
                        <td className="py-2 px-3 font-mono font-bold text-indigo-300">{log.totalLaptops}</td>
                        <td className="py-2 px-3 text-slate-400 text-[11px]">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Expandable Settings & Anti-Proxy Config */}
        {showSettingsPanel && (
          <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-slate-600" />
                Anti-Proxy Check-In & Device Restriction Rules
              </h4>
              <button
                onClick={onSimulateTestAlert}
                className="px-2.5 py-1 text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 rounded-md border border-amber-300 transition-colors cursor-pointer"
              >
                Test Alert Simulation
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Mode Toggle */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-semibold text-slate-800 block">Enforcement Mode:</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => onUpdateSettings({ strictMode: false })}
                    className={`flex-1 py-1.5 px-2 rounded text-[11px] font-medium border cursor-pointer ${
                      !settings.strictMode
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    Subtle Alert
                  </button>
                  <button
                    onClick={() => onUpdateSettings({ strictMode: true })}
                    className={`flex-1 py-1.5 px-2 rounded text-[11px] font-medium border cursor-pointer ${
                      settings.strictMode
                        ? 'bg-rose-50 border-rose-200 text-rose-700 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    Strict Lock
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  {settings.strictMode
                    ? 'Strict: Blocks second student from checking in on same device.'
                    : 'Subtle: Allows check-in, flags record & silently alerts admin page.'}
                </p>
              </div>

              {/* Cutoff Rules Info */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-semibold text-slate-800 block">Checkout Cut-Off Thresholds:</span>
                <div className="text-[11px] text-slate-600 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span><strong>4:15 PM:</strong> Yellow advisory notice, actual time credited.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span><strong>4:45 PM:</strong> Red critical cut-off, hours capped at 4:45 PM.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Danger Zone: Full Site Data Reset */}
            <div className="mt-3 p-3.5 rounded-lg bg-red-50/70 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-red-900">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>Danger Zone: Factory Reset Site Data</span>
                </div>
                <p className="text-[11px] text-red-800 leading-relaxed max-w-xl">
                  Permanently clear all attendance records across all dates, reset all-time laptops imaged to 0 for all members, wipe individual laptop logs, and clear security alerts.
                </p>
              </div>
              {onResetAllDataClick && (
                <button
                  id="btn-settings-reset-all"
                  type="button"
                  onClick={onResetAllDataClick}
                  className="px-3.5 py-2 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Wipe All Site Data</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live Anti-Proxy Security Alerts Section */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Live Anti-Proxy Alert Feed
                {stats.unacknowledgedAlerts > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold animate-pulse">
                    {stats.unacknowledgedAlerts} New
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">
                Subtle real-time notifications for potential multiple check-in attempts by a single person
              </p>
            </div>
          </div>

          {alerts.length > 0 && (
            <button
              onClick={onClearAlerts}
              className="text-xs font-medium text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {alerts.length === 0 ? (
          <div className="p-6 text-center text-slate-500">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-medium text-slate-800">No suspicious activity detected</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              All member check-ins and checkouts have been normal with no security notices.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {alerts.slice(0, 15).map((alert) => {
              const isLateCutoff = alert.type === 'LATE_CHECKOUT';
              const isPost415 = alert.type === 'POST_415_CHECKOUT';
              const matchedStudent = roster.find((s) => s.name === alert.currentStudent);
              const matchedRecord = matchedStudent ? recordsMap[matchedStudent.id] : null;

              return (
                <div
                  key={alert.id}
                  className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                    !alert.acknowledged
                      ? isPost415
                        ? 'bg-amber-50/60 border-l-4 border-l-amber-400'
                        : 'bg-rose-50/50 border-l-4 border-l-rose-500'
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isLateCutoff ? (
                        <span className="font-bold text-rose-900 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          4:45 PM Cut-Off Exceeded (Red Flag)
                        </span>
                      ) : isPost415 ? (
                        <span className="font-bold text-amber-900 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          Checked Out After 4:15 PM (Yellow Notice)
                        </span>
                      ) : (
                        <span className="font-bold text-rose-900 flex items-center gap-1">
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                          Device Integrity Notice (Red Flag)
                        </span>
                      )}

                      <span className="text-[11px] font-mono text-slate-400">
                        {alert.timeFormatted}
                      </span>
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                        {getFriendlyClientId(alert.clientId)}
                      </span>

                      {isLateCutoff && (
                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-200 rounded text-[10px] font-bold">
                          Hours Capped at 4:45 PM
                        </span>
                      )}
                      {isPost415 && (
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded text-[10px] font-semibold">
                          Actual Time Credited
                        </span>
                      )}
                    </div>

                    <p className="text-slate-700">
                      {alert.message}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center flex-wrap">
                    {/* For 4:45 PM cut-off alerts, provide direct Grant Exception button */}
                    {isLateCutoff && matchedRecord && (
                      <button
                        title="Grant 4:45 PM exception and input actual stop time"
                        onClick={() => setExceptionRecord(matchedRecord)}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white rounded-md font-bold text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer transition-all"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Grant Exception</span>
                      </button>
                    )}

                    {!alert.acknowledged && (
                      <button
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        className={`px-2.5 py-1 rounded-md font-medium text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer transition-colors ${
                          isPost415
                            ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                        }`}
                      >
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Acknowledge</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Complete Attendance Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Complete Attendance Roster ({roster.length} Members)
            </h3>
            <p className="text-xs text-slate-500">
              All {roster.length} club members in (Last Name, First Name) fashion with Pacific Time timestamps and duration
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search table..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48 text-slate-800"
              />
            </div>
            {onAddVolunteer && (
              <button
                id="btn-table-add-volunteer"
                type="button"
                onClick={() => setIsAddVolunteerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white rounded-lg text-xs font-semibold shadow-2xs transition-all cursor-pointer whitespace-nowrap"
                title="Add a new student volunteer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Volunteer</span>
              </button>
            )}
          </div>
        </div>

        {/* Time Policy Reference Strip */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5 font-medium text-indigo-900">
            <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span><strong>3:00 PM Policy:</strong> Kiosk check-in is restricted before 3:00 PM. Admins can click "Clock In" on any member to enter early hours.</span>
          </span>
          <span className="flex items-center gap-1.5 font-medium text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span><strong>4:15 PM Flag:</strong> Yellow Notice alert for checkouts between 4:15 &amp; 4:45 PM.</span>
          </span>
          <span className="flex items-center gap-1.5 font-medium text-rose-800">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span><strong>4:45 PM Cutoff:</strong> Red Flag alert; requires admin exception approval.</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-3 px-4">Member Name (Last, First)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Clock In</th>
                <th className="py-3 px-4">Clock Out</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4 text-center">Laptops</th>
                <th className="py-3 px-4">Flag</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredRecords.map((student) => {
                const rec = recordsMap[student.id];
                const isCheckedIn = Boolean(rec?.clockInTime);
                const isCheckedOut = Boolean(rec?.clockOutTime);
                const isFlagged = Boolean(rec?.isFlagged);
                const studentRecord: AttendanceRecord = rec || {
                  id: `${selectedDate}_${student.id}`,
                  date: selectedDate,
                  studentId: student.id,
                  studentName: student.name,
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
                  laptopLogs: [],
                };

                return (
                  <tr
                    key={student.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isFlagged ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {student.name}
                    </td>

                    <td className="py-3 px-4">
                      {isCheckedOut ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                          Clocked Out
                        </span>
                      ) : isCheckedIn ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[11px] font-normal px-2 py-0.5 rounded-md bg-slate-100 text-slate-500">
                          Absent
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono">
                      {rec?.clockInTime ? (
                        <span className="text-emerald-700 font-medium">
                          {rec.clockInTime}
                        </span>
                      ) : (
                        <span className="text-slate-300">--:--:--</span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono">
                      {rec?.clockOutTime ? (
                        <span className="text-indigo-700 font-medium">
                          {rec.clockOutTime}
                        </span>
                      ) : (
                        <span className="text-slate-300">--:--:--</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {rec?.durationMinutes !== null && rec?.durationMinutes !== undefined ? (
                        <span className="font-medium text-slate-800">
                          {Math.floor(rec.durationMinutes / 60)}h {rec.durationMinutes % 60}m
                        </span>
                      ) : (
                        <span className="text-slate-300">--</span>
                      )}
                    </td>

                    {/* Laptops Imaged with quick +1 / -1 */}
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
                        {onUpdateLaptops && (
                          <button
                            title="Decrease laptops by 1"
                            disabled={(rec?.laptopsImaged || 0) <= 0}
                            onClick={() => onUpdateLaptops({ studentId: student.id, delta: -1 })}
                            className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        )}
                        <span className="font-bold text-indigo-700 min-w-[20px] text-center font-mono">
                          {rec?.laptopsImaged || 0}
                        </span>
                        {onUpdateLaptops && (
                          <button
                            title="Increase laptops by 1"
                            onClick={() => onUpdateLaptops({ studentId: student.id, delta: 1 })}
                            className="p-0.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-slate-200/60 cursor-pointer transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        )}
                        {onUpdateLaptops && (
                          <button
                            title="Log detailed laptop entry (Model, Asset Tag, notes)"
                            onClick={() => setSelectedStudentForLog(student)}
                            className="p-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-200/60 cursor-pointer transition-colors ml-0.5 border-l border-slate-200 pl-1"
                          >
                            <FileText className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {rec?.cutoffExceeded && !rec?.exceptionGranted ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              title={rec?.flagReason || 'Attempted check-out after 4:45 PM cut-off (Hours capped)'}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 text-[10px] font-bold"
                            >
                              <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                              4:45 PM Cut-off
                            </span>
                            <button
                              type="button"
                              title="Make exception and enter actual time student stopped volunteering"
                              onClick={() => setExceptionRecord(rec)}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 active:scale-[0.97] text-white rounded text-[10px] font-bold shadow-2xs transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
                            >
                              <ShieldCheck className="w-2.5 h-2.5" />
                              <span>Grant Exception</span>
                            </button>
                          </div>
                        ) : rec?.lateCheckoutTier === 'post_415' && isFlagged ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              title={rec?.flagReason || 'Checked out after 4:15 PM notice'}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold"
                            >
                              <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                              After 4:15 PM
                            </span>
                            <button
                              type="button"
                              title="Dismiss yellow flag notice"
                              onClick={() => {
                                onAdjustRecord({
                                  studentId: student.id,
                                  clockInTime: rec.clockInTime,
                                  clockOutTime: rec.clockOutTime,
                                  isFlagged: false,
                                });
                              }}
                              className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded text-[10px] font-semibold transition-colors cursor-pointer"
                            >
                              Clear Flag
                            </button>
                          </div>
                        ) : rec?.exceptionGranted ? (
                          <span
                            title={`4:45 PM Exception approved. Volunteering hours credited up to ${rec.clockOutTime}. Note: ${rec.exceptionNote || 'Approved'}`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-semibold"
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            4:45 PM Exception
                          </span>
                        ) : isFlagged ? (
                          <span
                            title={rec?.flagReason || 'Flagged for review'}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold"
                          >
                            <ShieldAlert className="w-3 h-3 text-amber-600" />
                            Flagged
                          </span>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {/* Direct Check In button when absent / not clocked in */}
                        {!isCheckedIn && !isCheckedOut && (
                          <button
                            type="button"
                            title={`Check in ${student.name} now`}
                            onClick={() => onCheckIn(student.id)}
                            disabled={Boolean(loadingStates[student.id])}
                            className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs hover:shadow-xs disabled:opacity-50 whitespace-nowrap"
                          >
                            <LogIn className="w-3 h-3" />
                            <span>Check In</span>
                          </button>
                        )}

                        {/* Direct Check Out button when checked in */}
                        {isCheckedIn && !isCheckedOut && (
                          <button
                            type="button"
                            title={`Check out ${student.name} now`}
                            onClick={() => onCheckOut(student.id)}
                            disabled={Boolean(loadingStates[student.id])}
                            className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 shadow-2xs hover:shadow-xs disabled:opacity-50 whitespace-nowrap"
                          >
                            <LogOut className="w-3 h-3" />
                            <span>Check Out</span>
                          </button>
                        )}

                        {/* Re-Check In button when already checked out */}
                        {isCheckedOut && (
                          <button
                            type="button"
                            title={`Re-check in ${student.name}`}
                            onClick={() => onCheckIn(student.id)}
                            disabled={Boolean(loadingStates[student.id])}
                            className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                          >
                            <LogIn className="w-2.5 h-2.5 text-emerald-600" />
                            <span>Re-In</span>
                          </button>
                        )}

                        {/* Grant 4:45 PM cut-off exception button */}
                        {rec?.cutoffExceeded && !rec?.exceptionGranted && (
                          <button
                            type="button"
                            title="Grant 4:45 PM cut-off exception"
                            onClick={() => setExceptionRecord(rec)}
                            className="p-1.5 rounded-md text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 transition-colors cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Little pencil button: edit or adjust recorded times */}
                        <button
                          type="button"
                          title="Edit or adjust recorded times / custom hours"
                          onClick={() => setEditingRecord(studentRecord)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Reset attendance for today */}
                        {(isCheckedIn || isCheckedOut) && (
                          <button
                            type="button"
                            title={`Reset attendance for ${student.name} today`}
                            onClick={() => {
                              if (confirm(`Reset attendance for ${student.name}?`)) {
                                onResetStudent(student.id);
                              }
                            }}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 gap-2">
          <span>
            Displaying {filteredRecords.length} of {roster.length} members for {selectedDate}
          </span>
          <button
            onClick={handleExportCSV}
            className="text-indigo-600 font-semibold hover:underline flex items-center gap-1 self-start sm:self-auto cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Complete CSV
          </button>
        </div>
      </div>

      {/* Edit Record Modal */}
      {editingRecord && (
        <EditRecordModal
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={onAdjustRecord}
          onReset={onResetStudent}
        />
      )}

      {/* 4:45 PM Volunteering Cut-Off Exception Modal */}
      {exceptionRecord && (
        <CutoffExceptionModal
          isOpen={!!exceptionRecord}
          record={exceptionRecord}
          onClose={() => setExceptionRecord(null)}
          onApproveException={async (params) => {
            if (onApproveCutoffException) {
              await onApproveCutoffException(params);
            }
          }}
        />
      )}

      {/* Admin Detailed Laptop Logging Modal */}
      {selectedStudentForLog && onUpdateLaptops && (
        <LogLaptopModal
          student={selectedStudentForLog}
          record={recordsMap[selectedStudentForLog.id]}
          onClose={() => setSelectedStudentForLog(null)}
          onUpdateLaptops={onUpdateLaptops}
        />
      )}

      {/* Add New Volunteer Modal */}
      {onAddVolunteer && (
        <AddVolunteerModal
          isOpen={isAddVolunteerOpen}
          onClose={() => setIsAddVolunteerOpen(false)}
          onAddVolunteer={onAddVolunteer}
          existingRoster={roster}
        />
      )}

    </div>
  );
};
