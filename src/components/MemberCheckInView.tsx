import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  ArrowUpDown,
  Users,
  Filter,
  X,
  Laptop,
  Trophy,
  ChevronRight,
  Clock,
  Lock,
} from 'lucide-react';
import { AttendanceRecord, OverallImagingSummary, Student } from '../types';
import { MemberCard } from './MemberCard';

interface MemberCheckInViewProps {
  roster: Student[];
  recordsMap: Record<string, AttendanceRecord>;
  onCheckIn: (studentId: string) => Promise<void>;
  onCheckOut: (studentId: string) => Promise<void>;
  loadingStates: Record<string, boolean>;
  selectedDate: string;
  allTimeCounts?: Record<string, number>;
  summary?: OverallImagingSummary | null;
  onNavigateToLeaderboard?: () => void;
}

export const MemberCheckInView: React.FC<MemberCheckInViewProps> = ({
  roster,
  recordsMap,
  onCheckIn,
  onCheckOut,
  loadingStates,
  selectedDate,
  allTimeCounts = {},
  summary,
  onNavigateToLeaderboard,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'present' | 'completed' | 'absent'>('all');
  const [sortAlphabetical, setSortAlphabetical] = useState(false);

  // Real-time Pacific Time tracker for 3:00 PM check-in restriction
  const [currentPacificHour, setCurrentPacificHour] = useState<number>(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour12: false,
      hour: 'numeric',
    }).formatToParts(new Date());
    return parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: false,
        hour: 'numeric',
      }).formatToParts(new Date());
      setCurrentPacificHour(parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const isBefore3PM = currentPacificHour < 15;

  // Compute total session laptops
  const sessionLaptopsTotal = useMemo(() => {
    let count = 0;
    for (const s of roster) {
      count += recordsMap[s.id]?.laptopsImaged || 0;
    }
    return count;
  }, [roster, recordsMap]);

  const allTimeLaptopsTotal = useMemo(() => {
    let count = 0;
    for (const s of roster) {
      count += allTimeCounts[s.id] !== undefined ? allTimeCounts[s.id] : (recordsMap[s.id]?.laptopsImaged || 0);
    }
    return count;
  }, [roster, allTimeCounts, recordsMap]);

  // Filter and Sort roster
  const filteredRoster = useMemo(() => {
    let list = [...roster];

    // Sorting: original roster order vs A-Z
    if (sortAlphabetical) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.lastName.toLowerCase().includes(q) ||
          s.firstName.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (filterMode !== 'all') {
      list = list.filter((s) => {
        const rec = recordsMap[s.id];
        if (filterMode === 'present') return rec?.status === 'checked_in';
        if (filterMode === 'completed') return rec?.status === 'completed';
        if (filterMode === 'absent') return !rec?.clockInTime;
        return true;
      });
    }

    return list;
  }, [roster, recordsMap, searchQuery, filterMode, sortAlphabetical]);

  // Statistics calculation
  const stats = useMemo(() => {
    let present = 0;
    let completed = 0;
    let absent = 0;

    for (const student of roster) {
      const rec = recordsMap[student.id];
      if (rec?.status === 'checked_in') present++;
      else if (rec?.status === 'completed') completed++;
      else absent++;
    }

    const total = roster.length;
    const totalAttended = present + completed;
    const percentAttended = total > 0 ? Math.round((totalAttended / total) * 100) : 0;

    return { total, present, completed, absent, totalAttended, percentAttended };
  }, [roster, recordsMap]);

  return (
    <div className="space-y-6">
      
      {/* Welcome & Instructions Banner */}
      <div className="bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-sm border border-indigo-800/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-indigo-200 text-xs font-semibold">
                Club Session Kiosk
              </span>
              <span className="text-xs text-indigo-200">
                Session Date: {selectedDate}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
              Daily Attendance & Laptop Imaging Kiosk
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200/90 max-w-2xl leading-relaxed">
              Locate your name in <span className="font-semibold text-white">(Last Name, First Name)</span> order.
              Click <strong className="text-emerald-300">Check In</strong> upon arrival and{' '}
              <strong className="text-indigo-200">Check Out</strong> before departing.
            </p>
          </div>

          {/* Quick Attendance & Laptop Progress Cards */}
          <div className="flex flex-col sm:flex-row items-stretch gap-3 shrink-0">
            
            {/* Attendance Progress Card */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3.5 border border-white/10 min-w-[190px] shrink-0">
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1.5">
                <span className="font-medium">Attendance</span>
                <span className="font-bold text-white text-sm">{stats.percentAttended}%</span>
              </div>
              <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden mb-2">
                <div
                  className="bg-emerald-400 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${stats.percentAttended}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-indigo-100 font-medium">
                <span>{stats.present} in room</span>
                <span>{stats.completed} left</span>
                <span>{stats.absent} pending</span>
              </div>
            </div>

            {/* Laptop Progress Widget */}
            <div
              onClick={onNavigateToLeaderboard}
              className={`bg-indigo-600/30 hover:bg-indigo-600/40 backdrop-blur-md rounded-xl p-3.5 border border-indigo-400/30 min-w-[210px] shrink-0 transition-all ${
                onNavigateToLeaderboard ? 'cursor-pointer hover:border-indigo-300 group' : ''
              }`}
            >
              <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Laptop className="w-3.5 h-3.5 text-indigo-300" />
                  Laptops Imaged
                </span>
                {onNavigateToLeaderboard && (
                  <span className="text-[10px] text-indigo-300 flex items-center gap-0.5 group-hover:text-white font-medium">
                    Leaderboard <ChevronRight className="w-3 h-3" />
                  </span>
                )}
              </div>
              <div className="text-xl font-black text-white leading-tight">
                {sessionLaptopsTotal}{' '}
                <span className="text-xs font-normal text-indigo-200">today</span>
                <span className="text-xs text-indigo-300/80 font-normal ml-2">
                  ({allTimeLaptopsTotal} club total)
                </span>
              </div>
              <div className="text-[11px] text-indigo-200 font-medium mt-1 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">
                  {summary?.topStudentSession
                    ? `Top: ${summary.topStudentSession.name.split(',')[0]} (${summary.topStudentSession.count})`
                    : 'Click to view rankings'}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Early Check-In Notice Banner (Before 3:00 PM Pacific) */}
      {isBefore3PM && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 text-amber-900 flex items-start gap-3 shadow-xs">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-bold text-amber-950 text-sm flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Early Check-In Restricted: Volunteering Begins at 3:00 PM</span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              Volunteers cannot self-check-in before 3:00 PM Pacific Time. Self-service check-in will open at 3:00 PM. If an administrator authorized an early arrival, an admin must manually enter your start time in the <strong>Admin Panel</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Search, Filter & View Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          
          {/* Quick Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="input-search-members"
              type="text"
              placeholder="Search member by Last Name or First Name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-slate-900 transition-all placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                id="btn-clear-search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort Order Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-toggle-sort"
              onClick={() => setSortAlphabetical(!sortAlphabetical)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                sortAlphabetical
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="Toggle roster sort order"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>{sortAlphabetical ? 'Sorted: A-Z' : 'Roster Order'}</span>
            </button>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <span className="text-xs text-slate-400 flex items-center gap-1 font-medium mr-1">
            <Filter className="w-3 h-3" /> Filter:
          </span>
          <button
            id="filter-pill-all"
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterMode === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            id="filter-pill-present"
            onClick={() => setFilterMode('present')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterMode === 'present'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            Present Now ({stats.present})
          </button>
          <button
            id="filter-pill-completed"
            onClick={() => setFilterMode('completed')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterMode === 'completed'
                ? 'bg-indigo-700 text-white shadow-xs'
                : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'
            }`}
          >
            Clocked Out ({stats.completed})
          </button>
          <button
            id="filter-pill-absent"
            onClick={() => setFilterMode('absent')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterMode === 'absent'
                ? 'bg-slate-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Not Arrived ({stats.absent})
          </button>
        </div>
      </div>

      {/* Roster List of Member Cards */}
      {filteredRoster.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
          <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="font-semibold text-slate-700">No members found</p>
          <p className="text-xs text-slate-400 mt-1">Try clearing your search query or filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredRoster.map((student, idx) => {
            const originalIndex = roster.findIndex((s) => s.id === student.id);
            return (
              <MemberCard
                key={student.id}
                student={student}
                record={recordsMap[student.id]}
                index={originalIndex >= 0 ? originalIndex : idx}
                onCheckIn={onCheckIn}
                onCheckOut={onCheckOut}
                isLoading={loadingStates[student.id]}
                allTimeLaptops={allTimeCounts[student.id]}
                isBefore3PM={isBefore3PM}
              />
            );
          })}
        </div>
      )}

      {/* Footer Info Notice */}
      <div className="text-center text-xs text-slate-400 py-3">
        Showing {filteredRoster.length} of {roster.length} registered club members • Real-time synchronization active
      </div>
    </div>
  );
};
