import React, { useState, useMemo } from 'react';
import { Search, ArrowUpDown, Check, Users, Sparkles, Filter, X } from 'lucide-react';
import { AttendanceRecord, Student } from '../types';
import { MemberCard } from './MemberCard';

interface MemberCheckInViewProps {
  roster: Student[];
  recordsMap: Record<string, AttendanceRecord>;
  onCheckIn: (studentId: string) => Promise<void>;
  onCheckOut: (studentId: string) => Promise<void>;
  loadingStates: Record<string, boolean>;
  selectedDate: string;
}

export const MemberCheckInView: React.FC<MemberCheckInViewProps> = ({
  roster,
  recordsMap,
  onCheckIn,
  onCheckOut,
  loadingStates,
  selectedDate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'present' | 'completed' | 'absent'>('all');
  const [sortAlphabetical, setSortAlphabetical] = useState(false);

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
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-indigo-200 text-xs font-medium">
                Club Session Kiosk
              </span>
              <span className="text-xs text-indigo-200">
                Date: {selectedDate}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Daily Attendance Check-In
            </h2>
            <p className="text-xs sm:text-sm text-indigo-200/90 max-w-2xl">
              Locate your name in <span className="font-semibold text-white">(Last Name, First Name)</span> order.
              Click <strong className="text-emerald-300">Check In</strong> when you arrive, and{' '}
              <strong className="text-indigo-300">Check Out</strong> before leaving.
            </p>
          </div>

          {/* Quick Attendance Counter Card */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-3.5 border border-white/10 min-w-[210px] shrink-0">
            <div className="flex items-center justify-between text-xs text-indigo-200 mb-1.5">
              <span className="font-medium">Attendance Progress</span>
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
              <span>{stats.completed} clocked out</span>
              <span>{stats.absent} remaining</span>
            </div>
          </div>
        </div>
      </div>

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
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filterMode === 'absent'
                ? 'bg-slate-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Not Arrived ({stats.absent})
          </button>
        </div>
      </div>

      {/* Member Roster List */}
      {filteredRoster.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900">No matching members found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Try adjusting your search query or reset the filter to view all 28 roster members.
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setFilterMode('all');
            }}
            className="mt-4 px-3.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
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
