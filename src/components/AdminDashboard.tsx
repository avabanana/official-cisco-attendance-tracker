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
  Volume2,
  VolumeX,
  RotateCcw,
  Edit2,
  Search,
  Check,
  Trash2,
  Activity,
  Sliders,
} from 'lucide-react';
import { AttendanceRecord, SecurityAlert, SecuritySettings, Student } from '../types';
import { downloadAttendanceCSV } from '../utils/csv';
import { EditRecordModal } from './EditRecordModal';
import { getFriendlyClientId } from '../utils/clientId';

interface AdminDashboardProps {
  roster: Student[];
  recordsMap: Record<string, AttendanceRecord>;
  alerts: SecurityAlert[];
  settings: SecuritySettings;
  onUpdateSettings: (newSettings: Partial<SecuritySettings>) => Promise<void>;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onClearAlerts: () => Promise<void>;
  onResetStudent: (studentId: string) => Promise<void>;
  onAdjustRecord: (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
  }) => Promise<void>;
  onSimulateTestAlert: () => void;
  selectedDate: string;
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
  onAdjustRecord,
  onSimulateTestAlert,
  selectedDate,
}) => {
  const [tableSearch, setTableSearch] = useState('');
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  // Compute metrics
  const stats = useMemo(() => {
    let present = 0;
    let completed = 0;
    let absent = 0;
    let flagged = 0;

    for (const s of roster) {
      const rec = recordsMap[s.id];
      if (rec?.isFlagged) flagged++;
      if (rec?.status === 'checked_in') present++;
      else if (rec?.status === 'completed') completed++;
      else absent++;
    }

    const unacknowledgedAlerts = alerts.filter((a) => !a.acknowledged).length;

    return {
      total: roster.length,
      present,
      completed,
      absent,
      flagged,
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
    downloadAttendanceCSV(recordsList, selectedDate);
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
              Live monitor for club check-ins. Detects when multiple names are clicked in rapid succession from the same device to prevent proxy attendance.
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
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6 pt-5 border-t border-slate-100">
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

          <div
            className={`rounded-xl p-3.5 border transition-all col-span-2 sm:col-span-1 ${
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

        {/* Expandable Settings & Anti-Proxy Config */}
        {showSettingsPanel && (
          <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-slate-600" />
                Anti-Proxy Check-In Detection Rules
              </h4>
              <button
                onClick={onSimulateTestAlert}
                className="px-2.5 py-1 text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 rounded-md border border-amber-300 transition-colors cursor-pointer"
              >
                Test Alert Simulation
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {/* Threshold Slider */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between font-semibold text-slate-800">
                  <span>Rapid Detection Window:</span>
                  <span className="text-indigo-600">{settings.rapidThresholdSeconds} seconds</span>
                </div>
                <input
                  id="range-threshold"
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={settings.rapidThresholdSeconds}
                  onChange={(e) =>
                    onUpdateSettings({ rapidThresholdSeconds: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <p className="text-[10px] text-slate-500">
                  If two different names are clicked within this interval from the same terminal, an alert triggers.
                </p>
              </div>

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

              {/* Sound Toggle */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1.5">
                <span className="font-semibold text-slate-800 block">Admin Audio Alert:</span>
                <button
                  onClick={() => onUpdateSettings({ soundAlerts: !settings.soundAlerts })}
                  className={`w-full py-1.5 px-3 rounded text-[11px] font-medium border flex items-center justify-center gap-2 cursor-pointer ${
                    settings.soundAlerts
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  {settings.soundAlerts ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Audio Alert: Enabled</span>
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                      <span>Audio Alert: Silent</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-slate-500">
                  Plays a subtle chime on the admin dashboard when rapid clicks occur.
                </p>
              </div>
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
              All member check-ins have been normal with no rapid duplicate device clicks.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {alerts.slice(0, 15).map((alert) => (
              <div
                key={alert.id}
                className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                  !alert.acknowledged
                    ? 'bg-rose-50/40 border-l-4 border-l-rose-500'
                    : 'bg-white hover:bg-slate-50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">
                      ⚠️ Rapid Check-In Flagged
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {alert.timeFormatted}
                    </span>
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono">
                      {getFriendlyClientId(alert.clientId)}
                    </span>
                  </div>

                  <p className="text-slate-700">
                    <strong className="text-slate-900">{alert.currentStudent}</strong> was clicked{' '}
                    <span className="font-bold text-rose-600 underline">
                      {alert.timeDiffSeconds !== undefined ? `${alert.timeDiffSeconds}s` : 'rapidly'}
                    </span>{' '}
                    after <strong className="text-slate-900">{alert.previousStudent || 'another student'}</strong> from the same terminal.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  {!alert.acknowledged && (
                    <button
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md font-medium text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                    >
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>Acknowledge</span>
                    </button>
                  )}

                  {/* Quick Reset button to undo fraudulent check-in if leader spots it */}
                  {alert.currentStudent && (
                    <button
                      title="Undo fraudulent check-in for this student"
                      onClick={() => {
                        const student = roster.find((s) => s.name === alert.currentStudent);
                        if (student && confirm(`Undo check-in for "${student.name}"?`)) {
                          onResetStudent(student.id);
                        }
                      }}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md font-medium text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3 h-3 text-rose-600" />
                      <span>Reset Check-In</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
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
              All 28 club members in (Last Name, First Name) fashion with timestamps and duration
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
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4">Member Name (Last, First)</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Clock In</th>
                <th className="py-3 px-4">Clock Out</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Terminal / Flag</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredRecords.map((student, idx) => {
                const rec = recordsMap[student.id];
                const isCheckedIn = Boolean(rec?.clockInTime);
                const isCheckedOut = Boolean(rec?.clockOutTime);
                const isFlagged = Boolean(rec?.isFlagged);

                return (
                  <tr
                    key={student.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isFlagged ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="py-3 px-4 text-center font-mono text-slate-400">
                      {idx + 1}
                    </td>

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

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        {isFlagged ? (
                          <span
                            title={rec?.flagReason || 'Flagged for rapid check-in'}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Flagged
                          </span>
                        ) : rec?.checkedInByClientId ? (
                          <span className="text-[10px] font-mono text-slate-400">
                            {getFriendlyClientId(rec.checkedInByClientId)}
                          </span>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          title="Edit or adjust recorded times"
                          onClick={() => setEditingRecord(rec || null)}
                          className="p-1 rounded text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {(isCheckedIn || isCheckedOut) && (
                          <button
                            title="Reset student attendance record for today"
                            onClick={() => {
                              if (confirm(`Reset attendance for ${student.name}?`)) {
                                onResetStudent(student.id);
                              }
                            }}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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

    </div>
  );
};
