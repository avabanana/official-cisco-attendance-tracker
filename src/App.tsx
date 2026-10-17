import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CLUB_ROSTER } from './data/roster';
import { AttendanceRecord, ClubGoalSettings, OverallImagingSummary, SecurityAlert, SecuritySettings, Student } from './types';
import { Navbar } from './components/Navbar';
import { MemberCheckInView } from './components/MemberCheckInView';
import { AdminDashboard } from './components/AdminDashboard';
import { LaptopLeaderboardView } from './components/LaptopLeaderboardView';
import { AdminPasswordLock } from './components/AdminPasswordLock';
import { ResetDayModal } from './components/ResetDayModal';
import { ResetAllDataModal } from './components/ResetAllDataModal';
import { ToastContainer, ToastMessage } from './components/Toast';
import { getOrCreateClientId } from './utils/clientId';
import { playSuccessChime, playAdminAlertChime } from './utils/audio';
import { attendanceMap } from './utils/attendanceState';

const PACIFIC_TIMEZONE = 'America/Los_Angeles';

function getTodayDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getPacificHour(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    hour12: false,
    hour: 'numeric',
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
}

function formatCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: PACIFIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'checkin' | 'laptops' | 'admin'>('checkin');
  const [roster, setRoster] = useState<Student[]>(CLUB_ROSTER);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [recordsMap, setRecordsMap] = useState<Record<string, AttendanceRecord>>({});
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [settings, setSettings] = useState<SecuritySettings>({
    rapidThresholdSeconds: 20,
    strictMode: false,
    soundAlerts: true,
    kioskMode: true,
  });
  const [summary, setSummary] = useState<OverallImagingSummary | null>(null);
  const [allTimeCounts, setAllTimeCounts] = useState<Record<string, number>>({});
  const [allTimeHoursMap, setAllTimeHoursMap] = useState<Record<string, number>>({});
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  // Security requirement: Admin page must be relogged in every time you leave the admin page
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const adminTokenRef = useRef<string | null>(null);
  adminTokenRef.current = adminToken;

  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [isResetAllModalOpen, setIsResetAllModalOpen] = useState<boolean>(false);

  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const attendanceRequest = useRef(0);
  const pendingActions = useRef(new Set<string>());
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceReady, setAttendanceReady] = useState(false);

  // Automatically revoke admin session token & lock admin whenever navigating away from the admin page
  useEffect(() => {
    if (activeTab !== 'admin') {
      if (adminTokenRef.current) {
        fetch('/api/admin/logout', {
          method: 'POST',
          headers: { 'x-admin-token': adminTokenRef.current },
        }).catch(() => {});
      }
      setAdminToken(null);
      setIsAdminUnlocked(false);
    } else {
      // Clear all pop-up toasts immediately when entering admin mode
      setToasts([]);
    }
  }, [activeTab]);

  const handleUnlockAdmin = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        setAdminToken(data.token);
        setIsAdminUnlocked(true);
        setToasts([]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleLockAdmin = () => {
    if (adminTokenRef.current) {
      fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'x-admin-token': adminTokenRef.current },
      }).catch(() => {});
    }
    setAdminToken(null);
    setIsAdminUnlocked(false);
    setToasts([]);
  };

  const getAdminHeaders = useCallback((extraPassword?: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (adminTokenRef.current) {
      headers['x-admin-token'] = adminTokenRef.current;
    }
    if (extraPassword) {
      headers['x-admin-password'] = extraPassword;
    }
    return headers;
  }, []);

  const clientIdRef = useRef<string>('');
  const settingsRef = useRef<SecuritySettings>(settings);
  settingsRef.current = settings;

  const activeTabRef = useRef<'checkin' | 'laptops' | 'admin'>(activeTab);
  activeTabRef.current = activeTab;

  const isAdminUnlockedRef = useRef<boolean>(isAdminUnlocked);
  isAdminUnlockedRef.current = isAdminUnlocked;

  const addToast = useCallback((type: ToastMessage['type'], title: string, message?: string) => {
    // Completely suppress all pop-up toast notifications in the admin panel
    if (activeTabRef.current === 'admin') {
      return;
    }
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

  // Server-confirmed records only. No browser attendance cache, optimistic arrivals, or cross-date merging.
  const loadAttendance = useCallback(async (dateStr: string, background = false) => {
    const requestId = ++attendanceRequest.current;
    if (!background) { setAttendanceReady(false); setRecordsMap({}); }
    try {
      const res = await fetch(`/api/attendance?date=${encodeURIComponent(dateStr)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attendance could not be loaded');
      const map = attendanceMap(dateStr, data.records);
      if (requestId !== attendanceRequest.current || dateStr !== selectedDateRef.current) return;
      setRecordsMap(map);
      setAttendanceReady(true);
      setAttendanceError(null);
      setIsConnected(true);
    } catch (error: any) {
      if (requestId !== attendanceRequest.current || dateStr !== selectedDateRef.current) return;
      setRecordsMap({});
      setAttendanceReady(false);
      setAttendanceError(error.message || 'Attendance unavailable. Reload before taking attendance.');
      setIsConnected(false);
    }
  }, []);

  // Fetch Laptop Progress & Leaderboard Summary
  const loadLaptopSummary = useCallback(async (dateStr: string) => {
    try {
      const res = await fetch(`/api/laptops/summary?date=${encodeURIComponent(dateStr)}`);
      if (res.ok) {
        const data: OverallImagingSummary = await res.json();
        setSummary(data);

        // Map all-time counts per student
        const map: Record<string, number> = {};
        if (data.allTimeLeaderboard) {
          for (const entry of data.allTimeLeaderboard) {
            map[entry.studentId] = entry.allTimeLaptops;
          }
        }
        setAllTimeCounts(map);

        if (data.allTimeHoursMap) {
          setAllTimeHoursMap(data.allTimeHoursMap);
        }
      }
    } catch (err) {
      console.warn('Failed to load laptop summary:', err);
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

  // Fetch Club Roster
  const loadRoster = useCallback(async () => {
    try {
      const res = await fetch('/api/roster');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.roster) && data.roster.length > 0) {
          setRoster(data.roster);
        }
      }
    } catch {
      // Retain fallback roster
    }
  }, []);

  // Initial load when date changes
  useEffect(() => {
    loadRoster();
    loadAttendance(selectedDate);
    loadLaptopSummary(selectedDate);
    loadAlerts();
    loadSettings();
  }, [selectedDate, loadRoster, loadAttendance, loadLaptopSummary, loadAlerts, loadSettings]);

  useEffect(() => {
    const timer = setInterval(() => { if (!pendingActions.current.size) void loadAttendance(selectedDate, true); }, 30000);
    return () => clearInterval(timer);
  }, [selectedDate, loadAttendance]);

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

      eventSource.addEventListener('laptops_summary_updated', () => {
        loadLaptopSummary(selectedDate);
      });

      eventSource.addEventListener('roster_updated', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data.roster)) {
            setRoster(data.roster);
          }
          loadAttendance(selectedDate);
          loadLaptopSummary(selectedDate);
        } catch (err) {
          console.error('Failed to parse SSE roster_updated:', err);
        }
      });

      eventSource.addEventListener('goal_updated', (e: MessageEvent) => {
        try {
          const updatedGoal = JSON.parse(e.data);
          setSummary((prev) => (prev ? { ...prev, clubGoal: updatedGoal } : null));
        } catch (err) {
          console.error('Failed to parse SSE goal_updated:', err);
        }
      });

      eventSource.addEventListener('security_alert', (e: MessageEvent) => {
        try {
          const newAlert: SecurityAlert = JSON.parse(e.data);
          setAlerts((prev) => [newAlert, ...prev]);
          // Notifications and sounds in the admin panel are completely disabled per user preference.
        } catch (err) {
          console.error('Failed to parse SSE security_alert:', err);
        }
      });

      eventSource.addEventListener('day_reset', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          try {
            localStorage.removeItem(`club_records_${payload.date}`);
          } catch {}
          if (payload.date === selectedDate) {
            const map: Record<string, AttendanceRecord> = {};
            for (const rec of payload.records) {
              map[rec.studentId] = rec;
            }
            setRecordsMap(map);
            loadLaptopSummary(selectedDate);
          }
        } catch (err) {
          console.error('Failed to parse SSE day_reset:', err);
        }
      });

      eventSource.addEventListener('all_data_reset', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith('club_records_')) {
                localStorage.removeItem(k);
              }
            }
          } catch {}
          if (payload.records) {
            const map: Record<string, AttendanceRecord> = {};
            for (const rec of payload.records) {
              map[rec.studentId] = rec;
            }
            setRecordsMap(map);
          }
          setAlerts([]);
          loadLaptopSummary(selectedDate);
        } catch (err) {
          console.error('Failed to parse SSE all_data_reset:', err);
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
  }, [selectedDate, addToast, loadLaptopSummary]);

  // A deliberate button click is the only path into these mutations. Success follows the server commit.
  const performAttendanceAction = async (studentId: string, action: 'checkin' | 'checkout', isAdminAction = false) => {
    const date = selectedDate;
    if (!attendanceReady || pendingActions.current.has(`${date}:${studentId}`)) return;
    attendanceRequest.current++; // Invalidate any read started before this manual action.
    const admin = isAdminAction || (activeTabRef.current === 'admin' && isAdminUnlockedRef.current);
    pendingActions.current.add(`${date}:${studentId}`);
    setLoadingStates(prev => ({ ...prev, [studentId]: true }));
    try {
      const response = await fetch(`/api/${action}`, {
        method: 'POST', headers: getAdminHeaders(),
        body: JSON.stringify({ studentId, date, clientId: clientIdRef.current, isAdminOverride: admin, intent: 'manual' }),
      });
      const data = await response.json();
      if (!response.ok || !data.record) throw new Error(data.error || 'Attendance was not saved');
      if (selectedDateRef.current === date) {
        attendanceMap(date, [data.record]);
        setRecordsMap(prev => ({ ...prev, [studentId]: data.record }));
        setAttendanceError(null);
        if (activeTabRef.current !== 'admin') playSuccessChime();
        addToast('success', action === 'checkin' ? 'Checked In!' : 'Clocked Out!', `${data.record.studentName} — saved`);
        void loadLaptopSummary(date);
      }
    } catch (error: any) {
      if (selectedDateRef.current === date) {
        setAttendanceError(`${error.message}. Reload to verify attendance before retrying.`);
        addToast('error', 'Attendance not confirmed', error.message);
        // A response can be lost after commit. Reload rather than inventing or replaying a check-in.
        void loadAttendance(date);
      }
    } finally {
      pendingActions.current.delete(`${date}:${studentId}`);
      setLoadingStates(prev => ({ ...prev, [studentId]: false }));
    }
  };
  const handleCheckIn = (studentId: string, isAdminAction = false) => performAttendanceAction(studentId, 'checkin', isAdminAction);
  const handleCheckOut = (studentId: string) => performAttendanceAction(studentId, 'checkout');

  // Handler to approve 4:45 PM volunteering cut-off exception
  const handleApproveCutoffException = async (params: {
    studentId: string;
    actualTime: string;
    notes?: string;
  }) => {
    try {
      const res = await fetch('/api/approve-exception', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          studentId: params.studentId,
          date: selectedDate,
          actualTime: params.actualTime,
          notes: params.notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve 4:45 PM cut-off exception');
      }

      if (data.record) {
        setRecordsMap((prev) => ({
          ...prev,
          [params.studentId]: data.record,
        }));

      }

      addToast(
        'success',
        'Exception Approved',
        data.message || `Cut-off exception approved for ${params.actualTime}. Hours updated.`
      );
    } catch (err: any) {
      addToast('error', 'Exception Failed', err?.message || 'Could not approve exception');
      throw err;
    }
  };

  // Laptop Update Handler (Increment, Decrement, Set Count, or Log Model)
  const handleUpdateLaptops = async (params: {
    studentId: string;
    delta?: number;
    setCount?: number;
    log?: {
      model?: string;
      assetTag?: string;
      notes?: string;
      count?: number;
    };
  }) => {
    const { studentId, delta, setCount, log } = params;
    const student = roster.find((s) => s.id === studentId) || CLUB_ROSTER.find((s) => s.id === studentId);
    const prev = recordsMap[studentId];
    const currentCount = prev?.laptopsImaged || 0;
    let nextCount = currentCount;

    if (setCount !== undefined) {
      nextCount = Math.max(0, setCount);
    } else if (delta !== undefined) {
      nextCount = Math.max(0, currentCount + delta);
    }

    try {
      const res = await fetch('/api/laptops/update', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          studentId,
          date: selectedDate,
          delta,
          setCount,
          log,
          clientId: clientIdRef.current || 'client',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.record) {
          setRecordsMap((old) => ({
            ...old,
            [studentId]: data.record,
          }));

        }
        if (data.allTimeLaptops !== undefined) {
          setAllTimeCounts((old) => ({
            ...old,
            [studentId]: data.allTimeLaptops,
          }));
        }
        if (activeTabRef.current !== 'admin') {
          playSuccessChime();
        }

        if (delta && delta > 0) {
          addToast('success', '+1 Laptop Logged!', `${student?.name}: ${nextCount} imaged today`);
        } else if (log) {
          addToast('success', 'Laptop Logged', `${student?.name}: ${log.model || 'Laptop'} recorded`);
        }

        // Refresh overall summary
        loadLaptopSummary(selectedDate);
      } else {
        const errData = await res.json();
        setAttendanceError(errData.error || 'Laptop update was not saved');
        addToast('error', 'Error', errData.error || 'Failed to update laptops');
      }
    } catch (err) {
      setAttendanceError('Laptop update was not confirmed. Reload to verify before retrying.');
      void loadAttendance(selectedDate);
    }
  };

  // Club Target Goal Update
  const handleUpdateGoal = async (newGoal: Partial<ClubGoalSettings>) => {
    try {
      const res = await fetch('/api/laptops/goal', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify(newGoal),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.clubGoal) {
          setSummary((prev) => (prev ? { ...prev, clubGoal: data.clubGoal } : null));
        }
        addToast('success', 'Goal Updated', 'Club imaging targets saved');
      }
    } catch {
      addToast('error', 'Error', 'Failed to update goal');
    }
  };

  // Admin Reset Student
  const handleResetStudent = async (studentId: string) => {
    try {
      const res = await fetch('/api/reset-student', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ studentId, date: selectedDate }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
        addToast('info', 'Record Reset', `Attendance cleared for this member`);
        loadLaptopSummary(selectedDate);
      }
    } catch {
      addToast('error', 'Error', 'Failed to reset record');
    }
  };

  // Admin Adjust Times / Laptops
  const handleAdjustRecord = async (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
    laptopsImaged?: number;
  }) => {
    try {
      const res = await fetch('/api/adjust-time', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ ...updatedData, date: selectedDate }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecordsMap((prev) => ({
          ...prev,
          [updatedData.studentId]: data.record,
        }));

        addToast('success', 'Saved', 'Record updated successfully');
        loadLaptopSummary(selectedDate);
      }
    } catch {
      addToast('error', 'Error', 'Failed to save changes');
    }
  };

  const saveAdminMutation = async (endpoint: string, body: unknown = {}) => {
    const response = await fetch(endpoint, { method: 'POST', headers: getAdminHeaders(), body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save was not confirmed');
    return data;
  };
  const handleUpdateSettings = async (newSettings: Partial<SecuritySettings>) => {
    try { setSettings(await saveAdminMutation('/api/settings', newSettings)); }
    catch (error: any) { setAttendanceError(error.message); }
  };
  const handleAcknowledgeAlert = async (alertId: string) => {
    try { const data = await saveAdminMutation('/api/alerts/acknowledge', { alertId }); setAlerts(data.alerts); }
    catch (error: any) { setAttendanceError(error.message); }
  };
  const handleClearAlerts = async () => {
    try { const data = await saveAdminMutation('/api/alerts/clear'); setAlerts(data.alerts); }
    catch (error: any) { setAttendanceError(error.message); }
  };

  // Simulate Test Alert (for leadership to verify exception functionality easily)
  const handleSimulateTestAlert = () => {
    const s1 = CLUB_ROSTER[0].name; // Munoz, Kai
    const mockAlert: SecurityAlert = {
      id: `test-alert-${Date.now()}`,
      timestamp: Date.now(),
      date: selectedDate,
      timeFormatted: formatCurrentTime(),
      type: 'POST_415_CHECKOUT',
      severity: 'warning',
      currentStudent: s1,
      clientId: clientIdRef.current || 'terminal-test',
      message: `Test Simulation: "${s1}" checked out after 4:15 PM (${formatCurrentTime()}). Normal checkout credited; flagged as yellow admin notice.`,
      acknowledged: false,
    };
    setAlerts((prev) => [mockAlert, ...prev]);
  };

  // Handler to reset all attendance and laptop records across the currently selected calendar date
  const handleResetDay = async (password?: string) => {
    try {
      const res = await fetch('/api/reset-day', {
        method: 'POST',
        headers: getAdminHeaders(password),
        body: JSON.stringify({ date: selectedDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset day records');
      }

      const map: Record<string, AttendanceRecord> = {};
      for (const rec of data.records) {
        map[rec.studentId] = rec;
      }
      setRecordsMap(map);
      await loadLaptopSummary(selectedDate);
      addToast(
        'success',
        'Records Reset',
        `All attendance and laptop records for ${selectedDate} have been reset.`
      );
    } catch (err: any) {
      addToast('error', 'Reset Failed', err?.message || 'Could not reset day records');
      throw err;
    }
  };

  // Handler to completely wipe all site data (all-time laptops, all dates, alerts)
  const handleResetAllData = async (password?: string) => {
    try {
      const res = await fetch('/api/reset-all-data', {
        method: 'POST',
        headers: getAdminHeaders(password),
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to wipe site data');
      }

      const map: Record<string, AttendanceRecord> = {};
      for (const rec of data.records) {
        map[rec.studentId] = rec;
      }
      setRecordsMap(map);
      setAlerts([]);
      await loadLaptopSummary(selectedDate);
      addToast(
        'success',
        'Site Data Wiped',
        'All attendance history, all-time laptops imaged, and activity records have been reset to 0.'
      );
    } catch (err: any) {
      addToast('error', 'Reset Failed', err?.message || 'Could not reset all site data');
      throw err;
    }
  };

  // Add new student volunteer to roster
  const handleAddVolunteer = async (volunteerData: {
    firstName: string;
    lastName: string;
    clockInNow?: boolean;
  }) => {
    try {
      const res = await fetch('/api/roster/add', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          ...volunteerData,
          date: selectedDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to add student volunteer');
      }
      if (Array.isArray(data.roster)) {
        setRoster(data.roster);
      }
      await loadAttendance(selectedDate);
      await loadLaptopSummary(selectedDate);
      addToast(
        'success',
        'Volunteer Added',
        `Successfully added "${data.student.name}" to the club roster.`
      );
    } catch (err: any) {
      addToast('error', 'Error Adding Volunteer', err?.message || 'Failed to add volunteer');
      throw err;
    }
  };

  // Compute session laptops total
  const sessionLaptopsTotal = useMemo(() => {
    let count = 0;
    for (const s of roster) {
      count += recordsMap[s.id]?.laptopsImaged || 0;
    }
    return count;
  }, [roster, recordsMap]);

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
        sessionLaptopsTotal={sessionLaptopsTotal}
        isAdminUnlocked={isAdminUnlocked}
        onResetDayClick={() => setIsResetModalOpen(true)}
        totalMembers={roster.length}
      />

      {/* Main Content Area */}
      {attendanceError && <div role="alert" className="bg-red-50 border border-red-300 text-red-900 p-4">{attendanceError} <button onClick={() => loadAttendance(selectedDate)}>Reload attendance</button></div>}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'checkin' ? (
          <MemberCheckInView
            roster={roster}
            recordsMap={Object.fromEntries((Object.entries(recordsMap) as [string, AttendanceRecord][]).filter(([, r]) => r.date === selectedDate))}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
            loadingStates={Object.fromEntries(roster.map(s => [s.id, !attendanceReady || !!loadingStates[s.id]]))}
            selectedDate={selectedDate}
            allTimeCounts={allTimeCounts}
            summary={summary}
            onNavigateToLeaderboard={() => setActiveTab('laptops')}
          />
        ) : activeTab === 'laptops' ? (
          <LaptopLeaderboardView
            roster={roster}
            recordsMap={Object.fromEntries((Object.entries(recordsMap) as [string, AttendanceRecord][]).filter(([, r]) => r.date === selectedDate))}
            summary={summary}
            selectedDate={selectedDate}
            onUpdateGoal={handleUpdateGoal}
            allTimeCounts={allTimeCounts}
            allTimeHoursMap={allTimeHoursMap}
          />
        ) : !isAdminUnlocked ? (
          <AdminPasswordLock
            onUnlock={handleUnlockAdmin}
            onCancel={() => setActiveTab('checkin')}
          />
        ) : (
          <AdminDashboard
            roster={roster}
            recordsMap={Object.fromEntries((Object.entries(recordsMap) as [string, AttendanceRecord][]).filter(([, r]) => r.date === selectedDate))}
            alerts={alerts}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onClearAlerts={handleClearAlerts}
            onResetStudent={handleResetStudent}
            onCheckIn={(studentId) => handleCheckIn(studentId, true)}
            onCheckOut={handleCheckOut}
            loadingStates={Object.fromEntries(roster.map(s => [s.id, !attendanceReady || !!loadingStates[s.id]]))}
            onAdjustRecord={handleAdjustRecord}
            onSimulateTestAlert={handleSimulateTestAlert}
            selectedDate={selectedDate}
            onUpdateLaptops={handleUpdateLaptops}
            summary={summary}
            allTimeCounts={allTimeCounts}
            onNavigateToLeaderboard={() => setActiveTab('laptops')}
            onLockAdmin={handleLockAdmin}
            onResetDayClick={() => setIsResetModalOpen(true)}
            onResetAllDataClick={() => setIsResetAllModalOpen(true)}
            onApproveCutoffException={handleApproveCutoffException}
            onAddVolunteer={handleAddVolunteer}
            getAdminHeaders={getAdminHeaders}
          />
        )}
      </main>

      {/* Reset Day Records Modal */}
      <ResetDayModal
        date={selectedDate}
        isOpen={isResetModalOpen}
        isAdminUnlocked={isAdminUnlocked}
        onClose={() => setIsResetModalOpen(false)}
        onConfirmReset={handleResetDay}
      />

      {/* Reset All Site Data Modal */}
      <ResetAllDataModal
        isOpen={isResetAllModalOpen}
        isAdminUnlocked={isAdminUnlocked}
        onClose={() => setIsResetAllModalOpen(false)}
        onConfirmResetAll={handleResetAllData}
      />

      {/* Subtle Toast Notifications (Completely disabled when in the Admin Panel) */}
      {activeTab !== 'admin' && <ToastContainer toasts={toasts} onDismiss={dismissToast} />}

    </div>
  );
}
