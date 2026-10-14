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
import { useFirebase } from './context/FirebaseContext';

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

  const { syncRecordToFirestore, syncStudentToFirestore } = useFirebase();

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

  // Fetch Attendance Records for selected date
  const loadAttendance = useCallback(async (dateStr: string) => {
    // Check if we have an instant cached copy in localStorage to avoid flashes or lost state
    try {
      const cached = localStorage.getItem(`club_records_${dateStr}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          setRecordsMap((prev) => (Object.keys(prev).length === 0 ? parsed : prev));
        }
      }
    } catch {}

    try {
      const res = await fetch(`/api/attendance?date=${encodeURIComponent(dateStr)}`);
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, AttendanceRecord> = {};
        for (const rec of data.records) {
          map[rec.studentId] = rec;
        }

        // Smart merge: never overwrite an active record with an empty/absent record
        setRecordsMap((prev) => {
          const merged: Record<string, AttendanceRecord> = { ...map };
          const prevMap = prev as Record<string, AttendanceRecord>;
          for (const sId of Object.keys(prevMap)) {
            const prevRec = prevMap[sId];
            if (!prevRec) continue;
            const hasActivity = Boolean(
              prevRec.clockInTime ||
              prevRec.clockOutTime ||
              (typeof prevRec.laptopsImaged === 'number' && prevRec.laptopsImaged > 0)
            );
            const incomingEmpty =
              !merged[sId]?.clockInTime &&
              (!merged[sId]?.laptopsImaged || merged[sId]?.laptopsImaged === 0);
            if (hasActivity && incomingEmpty) {
              merged[sId] = prevRec;
            }
          }
          try {
            localStorage.setItem(`club_records_${dateStr}`, JSON.stringify(merged));
          } catch {}
          return merged;
        });
        setIsConnected(true);
      }
    } catch (err) {
      console.warn('Failed to load attendance from server, using local fallback:', err);
      // Initialize fallback if server is unreachable
      setRecordsMap((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<string, AttendanceRecord> = {};
        for (const s of roster) {
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
            laptopsImaged: 0,
            laptopLogs: [],
          };
        }
        return initial;
      });
    }
  }, [roster]);

  // Persist records to localStorage on any state change so data is never lost across reloads
  useEffect(() => {
    if (selectedDate && Object.keys(recordsMap).length > 0) {
      try {
        localStorage.setItem(`club_records_${selectedDate}`, JSON.stringify(recordsMap));
      } catch {}
    }
  }, [recordsMap, selectedDate]);

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

  // Check In Handler (Optimistic UI for ultra-responsiveness)
  const handleCheckIn = async (studentId: string, isAdminAction: boolean = false) => {
    const student = roster.find((s) => s.id === studentId) || CLUB_ROSTER.find((s) => s.id === studentId);
    if (!student) return;

    const isAdminCheckIn = isAdminAction || (activeTabRef.current === 'admin' && isAdminUnlockedRef.current);

    // Volunteering hours cannot start before 3:00 PM Pacific Time.
    // People cannot clock in before 3:00 PM unless an admin manually sets it or checks them in from the admin page.
    const currentPacificHour = getPacificHour();
    if (currentPacificHour < 15 && !isAdminCheckIn) {
      addToast(
        'error',
        'Check-In Restricted (Opens at 3:00 PM)',
        'Volunteering check-in is not permitted before 3:00 PM. If an administrator authorized your early arrival, they can check you in from the Admin Panel.'
      );
      return;
    }

    const now = Date.now();
    const formattedTime = formatCurrentTime();
    const currentClientId = isAdminCheckIn ? 'admin_panel' : (clientIdRef.current || 'client');

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
        laptopsImaged: 0,
        laptopLogs: [],
      }),
      clockInTime: formattedTime,
      clockInTimestamp: now,
      status: 'checked_in',
      checkedInByClientId: currentClientId,
      isFlagged: Boolean(prevRecord?.isFlagged),
      flagReason: prevRecord?.flagReason,
    };

    setRecordsMap((prev) => ({
      ...prev,
      [studentId]: optimisticRecord,
    }));

    if (!isAdminCheckIn && activeTabRef.current !== 'admin') {
      playSuccessChime();
      addToast('success', 'Checked In!', `${student.name} at ${formattedTime}`);
    }

    setLoadingStates((prev) => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          studentId,
          date: selectedDate,
          clientId: currentClientId,
          isAdminOverride: isAdminCheckIn,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Revert optimistic update
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: prevRecord || {
            id: `${selectedDate}_${studentId}`,
            date: selectedDate,
            studentId,
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
          },
        }));
        if (data.restrictedBefore3PM) {
          addToast('error', 'Early Check-In Restricted', data.error);
        } else if (data.deviceReuseBlocked) {
          addToast('error', 'Device Limit Reached', data.error);
        } else {
          addToast('error', 'Check-In Error', data.error || 'Failed to check in');
        }
      } else if (data.record) {
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
        syncRecordToFirestore(data.record).catch(console.error);
      }
    } catch (err) {
      console.warn('Network issue during check-in; retained optimistic state:', err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, [studentId]: false }));
    }
  };

  // Check Out Handler
  const handleCheckOut = async (studentId: string) => {
    const student = roster.find((s) => s.id === studentId) || CLUB_ROSTER.find((s) => s.id === studentId);
    const existing = recordsMap[studentId];
    if (!student || !existing) return;
    if (!existing.clockInTimestamp && !existing.clockInTime) return;

    const now = Date.now();
    const formattedTime = formatCurrentTime();
    const clockInTs = existing.clockInTimestamp || (now - 3600000);
    const durationMinutes = Math.max(1, Math.round((now - clockInTs) / 60000));
    const currentClientId = clientIdRef.current || 'client';
    const isAdminCheckOut = isAdminUnlockedRef.current;

    // Optimistic Update
    const optimisticRecord: AttendanceRecord = {
      ...existing,
      clockOutTime: formattedTime,
      clockOutTimestamp: now,
      durationMinutes,
      status: 'completed',
      checkedOutByClientId: isAdminCheckOut ? 'admin_panel' : currentClientId,
    };

    setRecordsMap((prev) => ({
      ...prev,
      [studentId]: optimisticRecord,
    }));

    if (activeTabRef.current !== 'admin') {
      playSuccessChime();
      addToast(
        'info',
        'Clocked Out!',
        `${student.name} at ${formattedTime} (${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m)`
      );
    }

    setLoadingStates((prev) => ({ ...prev, [studentId]: true }));

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          studentId,
          date: selectedDate,
          clientId: currentClientId,
          isAdminOverride: isAdminCheckOut,
        }),
      });

      const data = await res.json();
      if (res.ok && data.record) {
        setRecordsMap((prev) => ({
          ...prev,
          [studentId]: data.record,
        }));
        syncRecordToFirestore(data.record).catch(console.error);
        loadLaptopSummary(selectedDate);
      }
    } catch (err) {
      console.warn('Network issue during check-out; retained optimistic state:', err);
    } finally {
      setLoadingStates((prev) => ({ ...prev, [studentId]: false }));
    }
  };

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
        syncRecordToFirestore(data.record).catch(console.error);
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

    // Optimistic record update
    setRecordsMap((old) => {
      const existing = old[studentId] || prev;
      if (!existing) return old;
      return {
        ...old,
        [studentId]: {
          ...existing,
          laptopsImaged: nextCount,
        },
      };
    });

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
          syncRecordToFirestore(data.record).catch(console.error);
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
        addToast('error', 'Error', errData.error || 'Failed to update laptops');
      }
    } catch (err) {
      console.warn('Network issue during laptop update:', err);
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
        syncRecordToFirestore(data.record).catch(console.error);
        addToast('success', 'Saved', 'Record updated successfully');
        loadLaptopSummary(selectedDate);
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
        headers: getAdminHeaders(),
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
        headers: getAdminHeaders(),
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
      await fetch('/api/alerts/clear', {
        method: 'POST',
        headers: getAdminHeaders(),
      });
      addToast('info', 'Alerts Cleared', 'Security history cleared');
    } catch {
      // Graceful silence
    }
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
      if (data.student) {
        syncStudentToFirestore(data.student).catch(console.error);
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'checkin' ? (
          <MemberCheckInView
            roster={roster}
            recordsMap={recordsMap}
            onCheckIn={handleCheckIn}
            onCheckOut={handleCheckOut}
            loadingStates={loadingStates}
            selectedDate={selectedDate}
            allTimeCounts={allTimeCounts}
            summary={summary}
            onNavigateToLeaderboard={() => setActiveTab('laptops')}
          />
        ) : activeTab === 'laptops' ? (
          <LaptopLeaderboardView
            roster={roster}
            recordsMap={recordsMap}
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
            recordsMap={recordsMap}
            alerts={alerts}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onAcknowledgeAlert={handleAcknowledgeAlert}
            onClearAlerts={handleClearAlerts}
            onResetStudent={handleResetStudent}
            onCheckIn={(studentId) => handleCheckIn(studentId, true)}
            onCheckOut={handleCheckOut}
            loadingStates={loadingStates}
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
