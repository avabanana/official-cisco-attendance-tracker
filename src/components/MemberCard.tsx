import React from 'react';
import { LogIn, LogOut, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { AttendanceRecord, Student } from '../types';

interface MemberCardProps {
  student: Student;
  record?: AttendanceRecord;
  index: number;
  onCheckIn: (studentId: string) => void;
  onCheckOut: (studentId: string) => void;
  isLoading?: boolean;
}

export const MemberCard: React.FC<MemberCardProps> = ({
  student,
  record,
  index,
  onCheckIn,
  onCheckOut,
  isLoading,
}) => {
  const isCheckedIn = Boolean(record?.clockInTime);
  const isCheckedOut = Boolean(record?.clockOutTime);
  const isFlagged = Boolean(record?.isFlagged);

  return (
    <div
      id={`member-row-${student.id}`}
      className={`relative rounded-xl border p-4 transition-all duration-200 ${
        isCheckedOut
          ? 'bg-slate-50/70 border-slate-200'
          : isCheckedIn
          ? 'bg-emerald-50/40 border-emerald-200 shadow-xs'
          : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        {/* Student Info */}
        <div className="flex items-start sm:items-center space-x-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
              isCheckedOut
                ? 'bg-indigo-100 text-indigo-700'
                : isCheckedIn
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            #{index + 1}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {student.name}
              </h3>

              {/* Status Badge */}
              {isCheckedOut ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Clocked Out
                </span>
              ) : isCheckedIn ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Present
                </span>
              ) : (
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                  Not Arrived
                </span>
              )}

              {/* Flagged Badge */}
              {isFlagged && (
                <span
                  title={record?.flagReason || 'Flagged for rapid check-in'}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 cursor-help"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  Flagged
                </span>
              )}
            </div>

            {/* Time Stamp Details */}
            <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {record?.clockInTime ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <Clock className="w-3 h-3 text-emerald-600" />
                  In: {record.clockInTime}
                </span>
              ) : (
                <span className="text-slate-400">Clock in: pending</span>
              )}

              {record?.clockOutTime && (
                <span className="inline-flex items-center gap-1 text-indigo-700 font-medium">
                  <Clock className="w-3 h-3 text-indigo-600" />
                  Out: {record.clockOutTime}
                </span>
              )}

              {record?.durationMinutes !== null && record?.durationMinutes !== undefined && (
                <span className="text-slate-600 font-medium bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                  Duration: {Math.floor(record.durationMinutes / 60)}h {record.durationMinutes % 60}m
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Check In & Check Out Interactive Boxes */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 self-stretch sm:self-center">
          
          {/* Box 1: Check In Box */}
          <button
            id={`btn-checkin-${student.id}`}
            disabled={isCheckedIn || isLoading}
            onClick={() => onCheckIn(student.id)}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg font-medium text-xs transition-all ${
              isCheckedIn
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-default font-semibold'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] shadow-xs cursor-pointer'
            }`}
            title={isCheckedIn ? `Checked in at ${record?.clockInTime}` : `Click to check in ${student.name}`}
          >
            {isCheckedIn ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <div className="text-left leading-tight">
                  <span className="block font-semibold">Checked In</span>
                  <span className="text-[10px] font-normal opacity-90">{record?.clockInTime}</span>
                </div>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Check In</span>
              </>
            )}
          </button>

          {/* Box 2: Check Out Box */}
          <button
            id={`btn-checkout-${student.id}`}
            disabled={!isCheckedIn || isCheckedOut || isLoading}
            onClick={() => onCheckOut(student.id)}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg font-medium text-xs transition-all ${
              isCheckedOut
                ? 'bg-slate-100 text-slate-700 border border-slate-300 cursor-default font-semibold'
                : isCheckedIn
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-xs cursor-pointer'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
            }`}
            title={
              isCheckedOut
                ? `Clocked out at ${record?.clockOutTime}`
                : isCheckedIn
                ? `Click to clock out ${student.name}`
                : 'Must check in first before checking out'
            }
          >
            {isCheckedOut ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-slate-600" />
                <div className="text-left leading-tight">
                  <span className="block font-semibold">Clocked Out</span>
                  <span className="text-[10px] font-normal opacity-90">{record?.clockOutTime}</span>
                </div>
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4" />
                <span>Check Out</span>
              </>
            )}
          </button>

        </div>

      </div>
    </div>
  );
};
