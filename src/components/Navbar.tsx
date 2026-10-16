import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  ShieldAlert,
  Users,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  Trophy,
  Laptop,
  Lock,
  RotateCcw,
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'checkin' | 'laptops' | 'admin';
  setActiveTab: (tab: 'checkin' | 'laptops' | 'admin') => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  unreadAlertsCount: number;
  isConnected: boolean;
  sessionLaptopsTotal?: number;
  isAdminUnlocked?: boolean;
  onResetDayClick?: () => void;
  totalMembers?: number;
}

const PACIFIC_TIMEZONE = 'America/Los_Angeles';

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedDate,
  setSelectedDate,
  unreadAlertsCount,
  isConnected,
  sessionLaptopsTotal,
  isAdminUnlocked,
  onResetDayClick,
  totalMembers = 51,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          timeZone: PACIFIC_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const getTodayPacific = () => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: PACIFIC_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  };

  const changeDateBy = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const newY = date.getFullYear();
    const newM = String(date.getMonth() + 1).padStart(2, '0');
    const newD = String(date.getDate()).padStart(2, '0');
    setSelectedDate(`${newY}-${newM}-${newD}`);
  };

  const isToday = () => {
    return selectedDate === getTodayPacific();
  };

  const setToday = () => {
    setSelectedDate(getTodayPacific());
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between py-3.5 gap-3">
          
          {/* Logo & Title */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-800 flex items-center justify-center text-white shadow-sm font-bold text-lg tracking-tight">
                CA
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight flex items-center gap-2">
                  Club Attendance
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {totalMembers} Members
                  </span>
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 font-mono text-xs text-slate-500" title="Current Pacific Time (PT)">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{currentTime || 'Loading...'}</span>
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-1 py-0.2 rounded">PT</span>
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200" title="Server event connection; database verification is available in Admin">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    {isConnected ? 'Server online' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile Connection Indicator */}
          </div>

          {/* Date Selector & Navigation Controls */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200 text-xs">
              <button
                id="btn-prev-day"
                onClick={() => changeDateBy(-1)}
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
                title="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 px-2 font-medium text-slate-800">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <input
                  id="input-attendance-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer"
                />
              </div>
              <button
                id="btn-next-day"
                onClick={() => changeDateBy(1)}
                className="p-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
                title="Next Day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {!isToday() && (
                <button
                  id="btn-go-today"
                  onClick={setToday}
                  className="ml-1 px-1.5 py-0.5 text-[11px] bg-white text-indigo-600 font-semibold rounded border border-slate-200 hover:bg-indigo-50 transition-colors"
                >
                  Today
                </button>
              )}
            </div>

            {/* Red Reset Day Records Option */}
            {onResetDayClick && (
              <button
                id="btn-navbar-reset-day"
                type="button"
                onClick={onResetDayClick}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 hover:text-rose-800 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                title={`Reset all attendance and laptop records for ${selectedDate}`}
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="hidden sm:inline">Reset Day Records</span>
                <span className="sm:hidden">Reset Day</span>
              </button>
            )}

            {/* View Switcher Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
              <button
                id="tab-btn-checkin"
                onClick={() => setActiveTab('checkin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'checkin'
                    ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Check-In</span>
              </button>
              <button
                id="tab-btn-laptops"
                onClick={() => setActiveTab('laptops')}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'laptops'
                    ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Leadership Dashboard</span>
                {sessionLaptopsTotal !== undefined && (
                  <span className="flex items-center justify-center px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                    {sessionLaptopsTotal}
                  </span>
                )}
              </button>
              <button
                id="tab-btn-admin"
                onClick={() => setActiveTab('admin')}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'admin'
                    ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isAdminUnlocked ? (
                  <ShieldAlert className="w-3.5 h-3.5" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>Admin</span>
                {isAdminUnlocked && unreadAlertsCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-rose-500 text-white rounded-full text-[10px] font-bold animate-pulse">
                    {unreadAlertsCount}
                  </span>
                )}
              </button>
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};
