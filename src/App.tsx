import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CLUB_ROSTER } from './data/roster';
import { AttendanceRecord, SecurityAlert, SecuritySettings } from './types';
import { Navbar } from './components/Navbar';
import { MemberCheckInView } from './components/MemberCheckInView';
import { AdminDashboard } from './components/AdminDashboard';
import { ToastContainer, ToastMessage } from './components/Toast';
import { getOrCreateClientId } from './utils/clientId';
import { playSuccessChime, playAdminAlertChime } from './utils/audio';

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'checkin' | 'admin'>('checkin');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [recordsMap, setRecordsMap] = useState<Record<string, AttendanceRecord>>({});
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [settings, setSettings] = useState<SecuritySettings>({
    rapidThresholdSeconds: 20,
    strictMode: false,
    soundAlerts: true,
    kioskMode: true,
  });
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const clientIdRef = useRef<string>('');
  const settingsRef = useRef<SecuritySettings>(settings);
  settingsRef.current = settings;

  // Local rapid click tracker on client for instantaneous alert feedback
  const clientLastClickRef = useRef<{ studentId: string; studentName: string; timestamp: number } | null>(null);

  const addToast = useCallback((type: ToastMessage['type'], title: string, message?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Initialize client ID
  useEffect(() => {
    clientIdRef.current = getOrCreateClientId();
  }, []);

  // Fetch Attendance Records for selected date
  const loadAttendance = useCallback(async (dateStr: string) => {
    try {
      const res = await fetch(`/api/attendance?date=${encodeURIComponent(dateStr)}`);
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, AttendanceRecord> = {};
        for (const rec of data.records) {
          map[rec.studentId] = rec;
        }
        setRecordsMap(map);
        setIsConnected(true);
      }
    } catch (err) {
      console.warn('Failed to load attendance from server, using local fallback:', err);
      // Initialize fallback if server is unreachable
      setRecordsMap((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<string, AttendanceRecord> = {};
        for (const s of CLUB_ROSTER) {
          initial[s.id] = {
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
          };
        }
        return initial;
      });
    }
  }, []);

  // Fetch Alerts
  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  // Fetch Settings
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  // Initial load when date changes
  useEffect(() => {
    loadAttendance(selectedDate);
    loadAlerts();
    loadSettings();
  }, [selectedDate, loadAttendance, loadAlerts, loadSettings]);

  // Connect to SSE for real-time live events
  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource('/api/events');

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.addEventListener('record_updated', (e: MessageEvent) => {
        try {
          const updatedRecord: AttendanceRecord = JSON.parse(e.data);
          if (updatedRecord.date === selectedDate) {
            setRecordsMap((prev) => ({
              ...prev,
              [updatedRecord.studentId]: updatedRecord,
            }));
          }
        } catch (err) {
          console.error('Failed to parse SSE record_updated:', err);
        }
      });

      eventSource.addEventListener('security_alert', (e: MessageEvent) => {
        try {
          const newAlert: SecurityAlert = JSON.parse(e.data);
          setAlerts((prev) => [newAlert, ...prev]);

          if (settingsRef.current.soundAlerts) {
            playAdminAlertChime();
          }

          addToast(
            'warning',
            'Subtle Proxy Alert',
            `${newAlert.currentStudent} checked in ${newAlert.timeDiffSeconds}s after ${newAlert.previousStudent || 'another student'}`
          );
        } catch (err) {
          console.error('Failed to parse SSE security_alert:', err);
        }
      });

      eventSource.addEventListener('alerts_updated', (e: MessageEvent) => {
        try {
          const updatedAlerts = JSON.parse(e.data);
          setAlerts(updatedAlerts);
        } catch (err) {
          console.error('Failed to parse SSE alerts_updated:', err);
        }
      });

      eventSource.addEventListener('settings_updated', (e: MessageEvent) => {
        try {
          const updatedSettings = JSON.parse(e.data);
          setSettings(updatedSettings);
        } catch (err) {
          console.error('Failed to parse SSE settings_updated:', err);
        }
      });

      eventSource.onerror = () => {
        setIsConnected(false);
      };
    } catch (err) {
      console.warn('SSE not supported or failed to connect:', err);
      setIsConnected(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [selectedDate, addToast]);

  // Check In Handler (Optimistic UI for ultra-responsiveness)
  const handleCheckIn = async (studentId: string) => {
    const student = CLUB_ROSTER.find((s) => s.id === studentId);
    if (!student) return;

    const now = Date.now();
    const formattedTime = formatCurrentTime();
    const currentClientId = clientIdRef.current || 'client';

    // Client-side quick proxy check
    let clientFlagged = false;
    const lastClick = clientLastClickRef.current;
    if (lastClick && lastClick.studentId !== studentId) {
      const diffSec = Math.round((now - lastClick.timestamp) / 1000);
      if (diffSec <= settings.rapidThresholdSeconds) {
        clientFlagged = true;
        if (settings.strictMode) {
          addToast(
            'error',
            'Check-In Restricted',
            `Multiple student check-in is not permitted. Please wait ${settings.rapidThresholdSeconds - diffSec}s or ask club leader Ava Norgaard.`
          );
          return;
        }
      }
    }

    // Optimistic Update
    const prevRecord = recordsMap[studentId];
    const optimisticRecord: AttendanceRecord = {
      ...(prevRecord || {
        id: `${selectedDate}_${studentId}`,
        date: selectedDate,
        studentId,
        studentName: student.name,
        clockOutTime: null,
        clockOutTimestamp: null,
        durationMinutes: null,
        checkedOutByClientId: null,
      }),
      clockInTime: formattedTime,
      clockInTimestamp: now,
      status: 'checked_in',
      checkedInByClientId: currentClientId,
      isFlagged: clientFlagged || Boolean(prevRecord?.isFlagged),
      flagReason: clientFlagged
        ? `Rapid check-in (${Math.round((now - (lastClick?.timestamp || now)) / 1000)}s after ${lastClick?.studentName})`
        : prevRecord?.flagReason,
    };

    setRecordsMap((prev) => ({
      ...prev,
      [studentId]: optimisticRecord,
    }));

    playSuccessChime();
    addToast('success', 'Checked In!', `${student.name} at ${formattedTime}`);

    clientLastClickRef.current = {
      studentId,
      studentName: student.name,
      timestamp: now,
    };

    setLoadingStates((prev) => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          date: selectedDate,
          clientId: currentClientId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.flagged && settings.strictMode) {
          // Revert optimistic update
          setRecordsMap((prev) => ({
            ...prev,
            [studentId]: prevRecord,
          }));
          addToast('error', 'Action Restricted', data.error);
        } else {
          addToast('error', 'Error', data.error || 'Failed to check in');
        }
      } else if (data.record) {
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
      }
    } catch (err) {
      console.warn('Network issue during check-in; retained optimistic state:', err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, [studentId]: false }));
    }
  };

  // Check Out Handler
  const handleCheckOut = async (studentId: string) => {
    const student = CLUB_ROSTER.find((s) => s.id === studentId);
    const existing = recordsMap[studentId];
    if (!student || !existing || !existing.clockInTimestamp) return;

    const now = Date.now();
    const formattedTime = formatCurrentTime();
    const durationMinutes = Math.max(1, Math.round((now - existing.clockInTimestamp) / 60000));
    const currentClientId = clientIdRef.current || 'client';

    // Optimistic Update
    const optimisticRecord: AttendanceRecord = {
      ...existing,
      clockOutTime: formattedTime,
      clockOutTimestamp: now,
      durationMinutes,
      status: 'completed',
      checkedOutByClientId: currentClientId,
    };

    setRecordsMap((prev) => ({
      ...prev,
      [studentId]: optimisticRecord,
    }));

    playSuccessChime();
    addToast(
      'info',
      'Clocked Out!',
      `${student.name} at ${formattedTime} (${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m)`
    );

    setLoadingStates((prev) => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          date: selectedDate,
          clientId: currentClientId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.record) {
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
      }
    } catch (err) {
      console.warn('Network issue during check-out; retained optimistic state:', err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, [studentId]: false }));
    }
  };

  // Admin Reset Student
  const handleResetStudent = async (studentId: string) => {
    try {
      const res = await fetch('/api/reset-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, date: selectedDate }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
        addToast('info', 'Record Reset', `Attendance cleared for this member`);
      }
    } catch {
      addToast('error', 'Error', 'Failed to reset record');
    }
  };

  // Admin Adjust Times
  const handleAdjustRecord = async (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
  }) => {
    try {
      const res = await fetch('/api/adjust-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updatedData, date: selectedDate }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecordsMap((prev) => ({
          ...prev,
          [updatedData.studentId]: data.record,
        }));
        addToast('success', 'Saved', 'Record updated successfully');
      }
    } catch {
      addToast('error', 'Error', 'Failed to save changes');
    }
  };

  // Admin Update Settings
  const handleUpdateSettings = async (newSettings: Partial<SecuritySettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      addToast('success', 'Settings Updated', 'Anti-proxy rules saved');
    } catch {
      // Graceful silence
    }
  };

  // Admin Acknowledge Alert
  const handleAcknowledgeAlert = async (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
    );
    try {
      await fetch('/api/alerts/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
    } catch {
      // Graceful silence
    }
  };

  // Admin Clear Alerts
  const handleClearAlerts = async () => {
    setAlerts([]);
    try {
      await fetch('/api/alerts/clear', { method: 'POST' });
      addToast('info', 'Alerts Cleared', 'Security history cleared');
    } catch {
      // Graceful silence
    }
  };

  // Simulate Test Alert (for leader Ava Norgaard to verify functionality easily)
  const handleSimulateTestAlert = () => {
    const s1 = CLUB_ROSTER[0].name; // Munoz, Kai
    const s2 = CLUB_ROSTER[1].name; // Baum, Cameron
    const mockAlert: SecurityAlert = {
      id: `test-alert-${Date.now()}`,
      timestamp: Date.now(),
      date: selectedDate,
      timeFormatted: formatCurrentTime(),
      type: 'RAPID_CHECKIN',
      severity: 'warning',
      currentStudent: s2,
      previousStudent: s1,
      timeDiffSeconds: 3,
      clientId: clientIdRef.current || 'terminal-test',
      message: `Test Simulation: "${s2}" was checked in 3 seconds after "${s1}" from the same terminal.`,
      acknowledged: false,
    };
    setAlerts((prev) => [mockAlert, ...prev]);
    if (settings.soundAlerts) {
      playAdminAlertChime();
    }
    addToast('warning', 'Simulation Triggered', `Proxy alert simulated: ${s2} & ${s1} within 3s`);
  };

  const unreadAlertsCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        unreadAlertsCount={unreadAlertsCount}
        isConnected={isConnected}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'checkin' ? (
          <MemberCheckInView
            roster={CLUB_ROSTER}
            recordsMap={recordsMap}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
            loadingStates={loadingStates}
            selectedDate={selectedDate}
          />
        ) : (
          <AdminDashboard
            roster={CLUB_ROSTER}
            recordsMap={recordsMap}
            alerts={alerts}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onClearAlerts={handleClearAlerts}
            onResetStudent={handleResetStudent}
            onAdjustRecord={handleAdjustRecord}
            onSimulateTestAlert={handleSimulateTestAlert}
            selectedDate={selectedDate}
          />
        )}
      </main>

      {/* Subtle Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

    </div>
  );
}
