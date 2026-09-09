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
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'checkin' | 'admin';
  setActiveTab: (tab: 'checkin' | 'admin') => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  unreadAlertsCount: number;
  isConnected: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedDate,
  setSelectedDate,
  unreadAlertsCount,
  isConnected,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
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
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return selectedDate === todayStr;
  };

  const setToday = () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    setSelectedDate(todayStr);
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
                    28 Members
                  </span>
                </h1>
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <span>Leader: Norgaard, Ava</span>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-1 font-mono text-slate-600">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {currentTime || 'Loading...'}
                  </span>
                </p>
              </div>
            </div>

            {/* Mobile Connection Indicator */}
            <div className="flex items-center md:hidden">
              <span
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {isConnected ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 text-amber-600" />
                    Syncing
                  </>
                )}
              </span>
            </div>
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

            {/* View Switcher Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
              <button
                id="tab-btn-checkin"
                onClick={() => setActiveTab('checkin')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                  activeTab === 'checkin'
                    ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Member Check-In</span>
              </button>
              <button
                id="tab-btn-admin"
                onClick={() => setActiveTab('admin')}
                className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                  activeTab === 'admin'
                    ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Admin Dashboard</span>
                {unreadAlertsCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-rose-500 text-white rounded-full text-[10px] font-bold animate-pulse">
                    {unreadAlertsCount}
                  </span>
                )}
              </button>
            </div>

            {/* Desktop Real-Time Indicator */}
            <div className="hidden md:flex items-center">
              <span
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
                title={isConnected ? 'Connected to live server' : 'Reconnecting...'}
              >
                {isConnected ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Live Sync</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-600" />
                    <span>Connecting</span>
                  </>
                )}
              </span>
            </div>

          </div>

        </div>
      </div>
    </header>
  );
};
