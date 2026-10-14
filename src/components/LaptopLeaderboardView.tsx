import React, { useState, useMemo } from 'react';
import {
  Trophy,
  Laptop,
  Target,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  Award,
  Medal,
  Calendar,
  Check,
  Zap,
  Download,
} from 'lucide-react';
import { AttendanceRecord, ClubGoalSettings, ImagingLeaderboardEntry, OverallImagingSummary, Student } from '../types';
import { downloadLaptopsLeaderboardCSV } from '../utils/csv';

export type LeaderboardMode = 'total-hours' | 'all-time' | 'session';

interface LaptopLeaderboardViewProps {
  roster: Student[];
  recordsMap: Record<string, AttendanceRecord>;
  summary: OverallImagingSummary | null;
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
  onUpdateGoal?: (newGoal: Partial<ClubGoalSettings>) => Promise<void>;
  allTimeCounts: Record<string, number>;
  allTimeHoursMap?: Record<string, number>;
}

export const LaptopLeaderboardView: React.FC<LaptopLeaderboardViewProps> = ({
  roster,
  recordsMap,
  summary,
  selectedDate,
  allTimeCounts,
  allTimeHoursMap,
}) => {
  const [leaderboardMode, setLeaderboardMode] = useState<LeaderboardMode>('total-hours');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFilter, setFilterFilter] = useState<'all' | 'imaged-only' | 'present-only'>('all');

  // Compute leaderboards dynamically
  const sessionTotal = useMemo(() => {
    let sum = 0;
    for (const s of roster) {
      const rec = recordsMap[s.id];
      if (rec && typeof rec.laptopsImaged === 'number') {
        sum += rec.laptopsImaged;
      }
    }
    return sum;
  }, [roster, recordsMap]);

  const allTimeTotal = useMemo(() => {
    let sum = 0;
    for (const s of roster) {
      sum += allTimeCounts[s.id] || (recordsMap[s.id]?.laptopsImaged || 0);
    }
    return sum;
  }, [roster, allTimeCounts, recordsMap]);

  // Ranked lists
  const rankedEntries = useMemo(() => {
    const list: ImagingLeaderboardEntry[] = roster.map((student) => {
      const rec = recordsMap[student.id];
      const sLaptops = rec?.laptopsImaged || 0;
      const aLaptops = allTimeCounts[student.id] !== undefined ? allTimeCounts[student.id] : sLaptops;
      const allMins =
        allTimeHoursMap?.[student.id] ??
        summary?.allTimeHoursMap?.[student.id] ??
        0;
      const sessionsCount =
        summary?.allTimeSessionsMap?.[student.id] ??
        (rec?.clockInTime || (rec?.durationMinutes && rec.durationMinutes > 0) ? 1 : 0);
      const hoursVal = Math.floor(allMins / 60);
      const minsVal = allMins % 60;
      const formatted = allMins > 0 ? `${hoursVal}h ${minsVal}m` : '0h 0m';
      const decimal = parseFloat((allMins / 60).toFixed(2));

      return {
        studentId: student.id,
        studentName: student.name,
        lastName: student.lastName,
        firstName: student.firstName,
        sessionLaptops: sLaptops,
        allTimeLaptops: aLaptops,
        allTimeMinutes: allMins,
        allTimeHoursFormatted: formatted,
        allTimeHoursDecimal: decimal,
        sessionsAttended: sessionsCount,
        status: rec?.status || 'absent',
        clockInTime: rec?.clockInTime || null,
        durationMinutes: rec?.durationMinutes || null,
        rank: 0,
      };
    });

    if (leaderboardMode === 'total-hours') {
      list.sort((a, b) => {
        const minsA = a.allTimeMinutes || 0;
        const minsB = b.allTimeMinutes || 0;
        if (minsB !== minsA) return minsB - minsA;
        if (b.allTimeLaptops !== a.allTimeLaptops) return b.allTimeLaptops - a.allTimeLaptops;
        return a.studentName.localeCompare(b.studentName);
      });
    } else if (leaderboardMode === 'session') {
      list.sort((a, b) => {
        if (b.sessionLaptops !== a.sessionLaptops) return b.sessionLaptops - a.sessionLaptops;
        if (b.allTimeLaptops !== a.allTimeLaptops) return b.allTimeLaptops - a.allTimeLaptops;
        return a.studentName.localeCompare(b.studentName);
      });
    } else {
      list.sort((a, b) => {
        if (b.allTimeLaptops !== a.allTimeLaptops) return b.allTimeLaptops - a.allTimeLaptops;
        if (b.sessionLaptops !== a.sessionLaptops) return b.sessionLaptops - a.sessionLaptops;
        return a.studentName.localeCompare(b.studentName);
      });
    }

    list.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    return list;
  }, [roster, recordsMap, allTimeCounts, allTimeHoursMap, summary, leaderboardMode]);

  // Filtered entries for search & pills
  const filteredEntries = useMemo(() => {
    let list = [...rankedEntries];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.studentName.toLowerCase().includes(q) ||
          item.lastName.toLowerCase().includes(q) ||
          item.firstName.toLowerCase().includes(q)
      );
    }

    if (filterFilter === 'imaged-only') {
      if (leaderboardMode === 'total-hours') {
        list = list.filter((item) => (item.allTimeMinutes || 0) > 0);
      } else if (leaderboardMode === 'session') {
        list = list.filter((item) => item.sessionLaptops > 0);
      } else {
        list = list.filter((item) => item.allTimeLaptops > 0);
      }
    } else if (filterFilter === 'present-only') {
      list = list.filter((item) => item.status === 'checked_in' || item.status === 'completed');
    }

    return list;
  }, [rankedEntries, searchQuery, filterFilter, leaderboardMode]);

  // Top 3 Podium
  const topThree = useMemo(() => {
    return [rankedEntries[0], rankedEntries[1], rankedEntries[2]].filter(Boolean);
  }, [rankedEntries]);

  // Goal metrics
  const targetGoal = summary?.targetLaptops || 2500;
  const overallPercent = Math.min(100, Math.round((allTimeTotal / targetGoal) * 100));
  const sessionTarget = summary?.sessionTarget || 50;
  const sessionPercent = Math.min(100, Math.round((sessionTotal / sessionTarget) * 100));

  return (
    <div className="space-y-6">
      
      {/* Club Leadership & Overall Progress Card */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-5 sm:p-6 text-white shadow-sm border border-indigo-900/40 relative overflow-hidden">
        
        {/* Background Subtle Accent */}
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                Leadership & Operations Dashboard
              </span>
              <span className="text-xs text-indigo-300/80">
                Session: {selectedDate}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <span>Club Leadership & Member Rankings</span>
            </h2>

            <p className="text-xs sm:text-sm text-indigo-200/90 max-w-2xl leading-relaxed">
              Real-time dashboard tracking verified total volunteering hours and refurbished laptops imaged by all {roster.length} club members.
              View cumulative member contributions, all-time records, and session milestones!
            </p>
          </div>

        </div>

        {/* Progress Bars & Key Metrics Grid (3-card layout) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-5 border-t border-white/10">
          
          {/* Card 1: Total Club Volunteer Hours */}
          <div className="bg-white/5 backdrop-blur-xs rounded-xl p-4 border border-white/10 space-y-2 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-400" />
                Total Verified Club Hours
              </span>
              <span className="font-extrabold text-white text-sm">
                {summary?.allTimeTotalClubHours || 0} hrs
              </span>
            </div>

            <div className="py-1">
              <div className="text-2xl font-black text-white tracking-tight">
                {summary?.allTimeTotalClubHours || 0} <span className="text-sm font-semibold text-emerald-400">Total Hours</span>
              </div>
              <div className="text-[11px] text-emerald-200/80 mt-0.5">
                Cumulative verified hours across all meetings
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] text-indigo-200/80 pt-1 border-t border-white/10 font-medium">
              <span className="truncate">
                {summary?.topStudentHours ? `Top Contributor: ${summary.topStudentHours.name}` : `${roster.length} registered members`}
              </span>
              {summary?.topStudentHours && (
                <span className="text-emerald-300 font-bold ml-1 shrink-0">
                  {summary.topStudentHours.formatted}
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Overall Club Goal Progress */}
          <div className="bg-white/5 backdrop-blur-xs rounded-xl p-4 border border-white/10 space-y-2 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-indigo-400" />
                Overall Club Goal Progress
              </span>
              <span className="font-extrabold text-white text-sm">
                {allTimeTotal} / {targetGoal} ({overallPercent}%)
              </span>
            </div>

            <div className="w-full bg-white/15 h-3.5 rounded-full overflow-hidden p-0.5 border border-white/10">
              <div
                className="bg-gradient-to-r from-indigo-400 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-1"
                style={{ width: `${Math.max(5, overallPercent)}%` }}
              >
                {overallPercent >= 15 && (
                  <span className="text-[9px] font-black text-slate-900 leading-none">
                    {overallPercent}%
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] text-indigo-200/80 pt-0.5 font-medium">
              <span>0</span>
              <span className="text-emerald-300 font-semibold truncate px-1">
                {targetGoal - allTimeTotal > 0 ? `${targetGoal - allTimeTotal} laptops to goal` : '🎉 Goal Achieved!'}
              </span>
              <span>Target: {targetGoal}</span>
            </div>
          </div>

          {/* Card 3: Today's Session Progress */}
          <div className="bg-white/5 backdrop-blur-xs rounded-xl p-4 border border-white/10 space-y-2 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                This Session&apos;s Output ({selectedDate})
              </span>
              <span className="font-extrabold text-white text-sm">
                {sessionTotal} / {sessionTarget} ({sessionPercent}%)
              </span>
            </div>

            <div className="w-full bg-white/15 h-3.5 rounded-full overflow-hidden p-0.5 border border-white/10">
              <div
                className="bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-300 h-full rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-1"
                style={{ width: `${Math.max(5, sessionPercent)}%` }}
              >
                {sessionPercent >= 15 && (
                  <span className="text-[9px] font-black text-slate-900 leading-none">
                    {sessionPercent}%
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] text-indigo-200/80 pt-0.5 font-medium">
              <span>{summary?.activeImagersSessionCount || rankedEntries.filter((e) => e.sessionLaptops > 0).length} active imagers</span>
              <span className="text-amber-300 font-semibold truncate px-1">
                {sessionTarget - sessionTotal > 0 ? `${sessionTarget - sessionTotal} to goal` : '⚡ Daily Met!'}
              </span>
              <span>Target: {sessionTarget}</span>
            </div>
          </div>

        </div>

      </div>

      {/* Leaderboard View Switcher & Podium Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-6">
        
        {/* Switcher Bar: Total Hours vs All-Time Laptops vs This Session */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              {leaderboardMode === 'total-hours' ? (
                <Clock className="w-5 h-5 text-indigo-600" />
              ) : (
                <Trophy className="w-5 h-5 text-amber-500" />
              )}
              <span>
                {leaderboardMode === 'total-hours'
                  ? 'Cumulative Volunteer Hours Leaderboard'
                  : leaderboardMode === 'session'
                  ? 'Highest Imagers This Session'
                  : 'All-Time Club Champions (Laptops)'}
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              {leaderboardMode === 'total-hours'
                ? 'Ranking all club members by total cumulative hours completed across all meetings (not daily)'
                : leaderboardMode === 'session'
                ? `Showing laptops imaged during the club session on ${selectedDate}`
                : 'Showing cumulative refurbished laptops imaged across all club meetings'}
            </p>
          </div>

          <div className="flex flex-wrap bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold self-start sm:self-auto gap-1">
            <button
              id="tab-leaderboard-hours"
              onClick={() => setLeaderboardMode('total-hours')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                leaderboardMode === 'total-hours'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              <span>Total Hours Completed</span>
            </button>
            <button
              id="tab-leaderboard-alltime"
              onClick={() => setLeaderboardMode('all-time')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                leaderboardMode === 'all-time'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Award className="w-3.5 h-3.5 text-amber-500" />
              <span>All-Time Laptops</span>
            </button>
            <button
              id="tab-leaderboard-session"
              onClick={() => setLeaderboardMode('session')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                leaderboardMode === 'session'
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>This Session</span>
            </button>
          </div>
        </div>

        {/* Podium Top 3 Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          
          {/* 1st Place - Gold */}
          {topThree[0] && (
            <div className="relative rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-amber-50/80 to-white p-5 shadow-xs flex flex-col items-center text-center order-1 md:order-2">
              <div className="absolute -top-3 px-3 py-0.5 bg-amber-400 text-amber-950 rounded-full font-black text-[11px] shadow-xs flex items-center gap-1">
                {leaderboardMode === 'total-hours' ? (
                  <>
                    <Clock className="w-3 h-3 text-amber-950" />
                    #1 Volunteer Hours Leader
                  </>
                ) : (
                  <>
                    <Trophy className="w-3 h-3" />
                    #1 Top Imager
                  </>
                )}
              </div>
              
              <div className="w-14 h-14 rounded-2xl bg-amber-100 border-2 border-amber-300 text-amber-800 flex items-center justify-center font-black text-xl shadow-xs mt-2 mb-2.5">
                🥇
              </div>

              <h4 className="font-bold text-slate-900 text-base leading-tight truncate max-w-full">
                {topThree[0].studentName}
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                {topThree[0].status === 'checked_in'
                  ? 'Active in room'
                  : topThree[0].status === 'completed'
                  ? 'Clocked out'
                  : 'Absent today'}
              </p>

              <div className="w-full bg-amber-100/60 rounded-xl py-2.5 px-3 border border-amber-200/80">
                <div className="text-2xl font-black text-amber-900">
                  {leaderboardMode === 'total-hours'
                    ? topThree[0].allTimeHoursFormatted
                    : leaderboardMode === 'session'
                    ? topThree[0].sessionLaptops
                    : topThree[0].allTimeLaptops}
                </div>
                <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
                  {leaderboardMode === 'total-hours'
                    ? `Total Hours Completed (${topThree[0].allTimeHoursDecimal} hrs)`
                    : leaderboardMode === 'session'
                    ? 'Laptops Imaged Today'
                    : 'All-Time Laptops'}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                {leaderboardMode === 'total-hours' ? (
                  <span>Sessions: <strong className="text-slate-900">{topThree[0].sessionsAttended || 0}</strong> • Laptops: <strong className="text-slate-900">{topThree[0].allTimeLaptops}</strong></span>
                ) : (
                  <span>All-Time Total: <strong className="text-slate-900">{topThree[0].allTimeLaptops}</strong> • Hours: <strong className="text-slate-900">{topThree[0].allTimeHoursFormatted}</strong></span>
                )}
              </div>
            </div>
          )}

          {/* 2nd Place - Silver */}
          {topThree[1] && (
            <div className="relative rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/90 to-white p-5 shadow-xs flex flex-col items-center text-center order-2 md:order-1">
              <div className="absolute -top-3 px-3 py-0.5 bg-slate-300 text-slate-800 rounded-full font-bold text-[11px] shadow-xs flex items-center gap-1">
                <Medal className="w-3 h-3 text-slate-600" />
                #2 Runner Up
              </div>

              <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center font-black text-lg shadow-xs mt-2 mb-2.5">
                🥈
              </div>

              <h4 className="font-bold text-slate-900 text-base leading-tight truncate max-w-full">
                {topThree[1].studentName}
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                {topThree[1].status === 'checked_in'
                  ? 'Active in room'
                  : topThree[1].status === 'completed'
                  ? 'Clocked out'
                  : 'Absent today'}
              </p>

              <div className="w-full bg-slate-100 rounded-xl py-2.5 px-3 border border-slate-200">
                <div className="text-xl font-bold text-slate-800">
                  {leaderboardMode === 'total-hours'
                    ? topThree[1].allTimeHoursFormatted
                    : leaderboardMode === 'session'
                    ? topThree[1].sessionLaptops
                    : topThree[1].allTimeLaptops}
                </div>
                <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                  {leaderboardMode === 'total-hours'
                    ? `Total Hours Completed (${topThree[1].allTimeHoursDecimal} hrs)`
                    : leaderboardMode === 'session'
                    ? 'Laptops Imaged Today'
                    : 'All-Time Laptops'}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                {leaderboardMode === 'total-hours' ? (
                  <span>Sessions: <strong className="text-slate-900">{topThree[1].sessionsAttended || 0}</strong> • Laptops: <strong className="text-slate-900">{topThree[1].allTimeLaptops}</strong></span>
                ) : (
                  <span>All-Time Total: <strong className="text-slate-900">{topThree[1].allTimeLaptops}</strong> • Hours: <strong className="text-slate-900">{topThree[1].allTimeHoursFormatted}</strong></span>
                )}
              </div>
            </div>
          )}

          {/* 3rd Place - Bronze */}
          {topThree[2] && (
            <div className="relative rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50/40 to-white p-5 shadow-xs flex flex-col items-center text-center order-3 md:order-3">
              <div className="absolute -top-3 px-3 py-0.5 bg-amber-200 text-amber-900 rounded-full font-bold text-[11px] shadow-xs flex items-center gap-1">
                <Medal className="w-3 h-3 text-amber-700" />
                #3 Third Place
              </div>

              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center font-black text-lg shadow-xs mt-2 mb-2.5">
                🥉
              </div>

              <h4 className="font-bold text-slate-900 text-base leading-tight truncate max-w-full">
                {topThree[2].studentName}
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                {topThree[2].status === 'checked_in'
                  ? 'Active in room'
                  : topThree[2].status === 'completed'
                  ? 'Clocked out'
                  : 'Absent today'}
              </p>

              <div className="w-full bg-amber-50/70 rounded-xl py-2.5 px-3 border border-amber-200/60">
                <div className="text-xl font-bold text-amber-900">
                  {leaderboardMode === 'total-hours'
                    ? topThree[2].allTimeHoursFormatted
                    : leaderboardMode === 'session'
                    ? topThree[2].sessionLaptops
                    : topThree[2].allTimeLaptops}
                </div>
                <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
                  {leaderboardMode === 'total-hours'
                    ? `Total Hours Completed (${topThree[2].allTimeHoursDecimal} hrs)`
                    : leaderboardMode === 'session'
                    ? 'Laptops Imaged Today'
                    : 'All-Time Laptops'}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                {leaderboardMode === 'total-hours' ? (
                  <span>Sessions: <strong className="text-slate-900">{topThree[2].sessionsAttended || 0}</strong> • Laptops: <strong className="text-slate-900">{topThree[2].allTimeLaptops}</strong></span>
                ) : (
                  <span>All-Time Total: <strong className="text-slate-900">{topThree[2].allTimeLaptops}</strong> • Hours: <strong className="text-slate-900">{topThree[2].allTimeHoursFormatted}</strong></span>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-2">
          
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="input-search-leaderboard"
              type="text"
              placeholder="Search member in rankings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-slate-900 transition-all placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="filter-all"
              onClick={() => setFilterFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                filterFilter === 'all'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All {roster.length} Members
            </button>
            <button
              id="filter-imaged"
              onClick={() => setFilterFilter('imaged-only')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                filterFilter === 'imaged-only'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {leaderboardMode === 'total-hours'
                ? 'With Hours (> 0h)'
                : leaderboardMode === 'session'
                ? 'Imaged Today > 0'
                : 'Imaged > 0 Only'}
            </button>
            <button
              id="filter-present"
              onClick={() => setFilterFilter('present-only')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                filterFilter === 'present-only'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Attending Today
            </button>

            {/* CSV Export Button */}
            <button
              id="btn-export-leaderboard-csv"
              onClick={() => downloadLaptopsLeaderboardCSV(filteredEntries, selectedDate, leaderboardMode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-xs cursor-pointer ml-auto"
              title="Download Leaderboard as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

        </div>

        {/* Full Rankings Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th scope="col" className="px-4 py-3 text-center w-12">Rank</th>
                <th scope="col" className="px-4 py-3">Member Name (Last, First)</th>
                {leaderboardMode === 'total-hours' ? (
                  <>
                    <th scope="col" className="px-4 py-3 text-center">Total Hours Completed</th>
                    <th scope="col" className="px-4 py-3 text-center">Sessions Attended</th>
                    <th scope="col" className="px-4 py-3 text-center">All-Time Laptops</th>
                  </>
                ) : leaderboardMode === 'all-time' ? (
                  <>
                    <th scope="col" className="px-4 py-3 text-center">All-Time Laptops</th>
                    <th scope="col" className="px-4 py-3 text-center">Total Hours</th>
                    <th scope="col" className="px-4 py-3 text-center">Session Laptops</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="px-4 py-3 text-center">Session Laptops</th>
                    <th scope="col" className="px-4 py-3 text-center">All-Time Laptops</th>
                    <th scope="col" className="px-4 py-3 text-center">Total Hours</th>
                  </>
                )}
                <th scope="col" className="px-4 py-3">Today&apos;s Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredEntries.map((entry) => {
                let maxMetric = 1;
                let currentMetric = 0;

                if (leaderboardMode === 'total-hours') {
                  maxMetric = topThree[0]?.allTimeMinutes || 1;
                  currentMetric = entry.allTimeMinutes || 0;
                } else if (leaderboardMode === 'session') {
                  maxMetric = topThree[0]?.sessionLaptops || 1;
                  currentMetric = entry.sessionLaptops;
                } else {
                  maxMetric = topThree[0]?.allTimeLaptops || 1;
                  currentMetric = entry.allTimeLaptops;
                }

                const percentOfLeader = Math.min(100, Math.round((currentMetric / maxMetric) * 100));

                return (
                  <tr
                    key={entry.studentId}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      entry.rank === 1 ? 'bg-amber-50/30 font-medium' : ''
                    }`}
                  >
                    {/* Rank */}
                    <td className="px-4 py-3 text-center font-bold">
                      {entry.rank === 1 ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-amber-950 font-black text-xs">
                          1
                        </span>
                      ) : entry.rank === 2 ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-800 font-bold text-xs">
                          2
                        </span>
                      ) : entry.rank === 3 ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-200 text-amber-900 font-bold text-xs">
                          3
                        </span>
                      ) : (
                        <span className="text-slate-400 font-semibold">#{entry.rank}</span>
                      )}
                    </td>

                    {/* Member */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 text-sm">
                        {entry.studentName}
                      </div>
                      <div className="w-32 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            leaderboardMode === 'total-hours' ? 'bg-indigo-600' : 'bg-emerald-600'
                          }`}
                          style={{ width: `${percentOfLeader}%` }}
                        />
                      </div>
                    </td>

                    {/* Mode Specific Columns */}
                    {leaderboardMode === 'total-hours' ? (
                      <>
                        {/* Total Hours Completed */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 font-extrabold text-sm px-2.5 py-1 rounded-lg ${
                              (entry.allTimeMinutes || 0) > 0
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'text-slate-400 bg-slate-50'
                            }`}
                          >
                            <Clock className="w-3 h-3 text-indigo-500" />
                            {entry.allTimeHoursFormatted || '0h 0m'}
                          </span>
                          {(entry.allTimeMinutes || 0) > 0 && (
                            <span className="text-[10px] text-slate-500 block font-medium mt-0.5">
                              {entry.allTimeHoursDecimal} hrs
                            </span>
                          )}
                        </td>

                        {/* Sessions Attended */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-slate-800 text-sm">
                            {entry.sessionsAttended || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 block">sessions</span>
                        </td>

                        {/* All-Time Laptops */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-slate-700 text-sm">
                            {entry.allTimeLaptops}
                          </span>
                        </td>
                      </>
                    ) : leaderboardMode === 'all-time' ? (
                      <>
                        {/* All-Time Count */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center justify-center font-extrabold text-sm px-2.5 py-1 rounded-lg ${
                              entry.allTimeLaptops > 0
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'text-slate-400'
                            }`}
                          >
                            {entry.allTimeLaptops}
                          </span>
                        </td>

                        {/* Total Hours */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-slate-800 text-xs">
                            {entry.allTimeHoursFormatted || '0h 0m'}
                          </span>
                        </td>

                        {/* Session Count */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-slate-600 text-xs">
                            {entry.sessionLaptops}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Session Count */}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center justify-center font-extrabold text-sm px-2.5 py-1 rounded-lg ${
                              entry.sessionLaptops > 0
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'text-slate-400'
                            }`}
                          >
                            {entry.sessionLaptops}
                          </span>
                        </td>

                        {/* All-Time Count */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-slate-800 text-sm">
                            {entry.allTimeLaptops}
                          </span>
                        </td>

                        {/* Total Hours */}
                        <td className="px-4 py-3 text-center">
                          <span className="font-semibold text-slate-600 text-xs">
                            {entry.allTimeHoursFormatted || '0h 0m'}
                          </span>
                        </td>
                      </>
                    )}

                    {/* Today's Status */}
                    <td className="px-4 py-3">
                      {entry.status === 'checked_in' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          In Room ({entry.clockInTime})
                        </span>
                      ) : entry.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                          <CheckCircle2 className="w-3 h-3 text-slate-500" />
                          Clocked Out
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Not arrived</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
