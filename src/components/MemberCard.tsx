import React from 'react';
import { LogIn, LogOut, CheckCircle2, Clock, Laptop, Lock } from 'lucide-react';
import { AttendanceRecord, Student } from '../types';

interface MemberCardProps {
  student: Student;
  record?: AttendanceRecord;
  index?: number;
  onCheckIn: (studentId: string) => void;
  onCheckOut: (studentId: string) => void;
  isLoading?: boolean;
  onUpdateLaptops?: (params: {
    studentId: string;
    delta?: number;
    setCount?: number;
  }) => Promise<void>;
  onOpenLaptopModal?: (student: Student) => void;
  allTimeLaptops?: number;
  isBefore3PM?: boolean;
}

export const MemberCard: React.FC<MemberCardProps> = ({
  student,
  record,
  onCheckIn,
  onCheckOut,
  isLoading,
  allTimeLaptops,
  isBefore3PM = false,
}) => {
  const isCheckedIn = Boolean(record?.clockInTime);
  const isCheckedOut = Boolean(record?.clockOutTime);
  const isFlagged = Boolean(record?.isFlagged);
  const laptopsImaged = record?.laptopsImaged || 0;
  const cumulativeLaptops = allTimeLaptops !== undefined ? allTimeLaptops : laptopsImaged;

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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        
        {/* Student Info */}
        <div className="flex items-start sm:items-center space-x-3 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-900 break-words">
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

              {/* Cumulative Laptops Badge */}
              {cumulativeLaptops > 0 && (
                <span
                  title={`All-Time Total: ${cumulativeLaptops} laptops imaged`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                >
                  <Laptop className="w-3 h-3 text-slate-500" />
                  <span>Total: {cumulativeLaptops}</span>
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

        {/* Right side: Laptop Imaging Counter & Check In / Out Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
          
          {/* Read-Only Laptops Imaged Display (Managed by Admin) */}
          <div
            className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 rounded-lg px-2.5 py-1.5"
            title={`${student.name}: ${laptopsImaged} laptop${laptopsImaged === 1 ? '' : 's'} imaged today (${cumulativeLaptops} total all-time). Laptops are entered by the club administrator.`}
          >
            <Laptop className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">
              Imaged:
            </span>
            <span className="inline-flex items-center justify-center font-mono text-xs font-bold text-indigo-700 bg-white border border-indigo-200/80 rounded px-1.5 py-0.5 min-w-[22px]">
              {laptopsImaged}
            </span>
          </div>

          {/* Check In & Check Out Interactive Boxes */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Box 1: Check In Box */}
            <button
              id={`btn-checkin-${student.id}`}
              disabled={isCheckedIn || isLoading}
              onClick={() => onCheckIn(student.id)}
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg font-medium text-xs transition-all ${
                isCheckedIn
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-default font-semibold'
                  : isBefore3PM
                  ? 'bg-amber-100/90 hover:bg-amber-200 text-amber-900 border border-amber-300/90 active:scale-[0.98] shadow-xs cursor-pointer font-semibold'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] shadow-xs cursor-pointer'
              }`}
              title={
                isCheckedIn
                  ? `Checked in at ${record?.clockInTime}`
                  : isBefore3PM
                  ? `Volunteering check-in opens at 3:00 PM. Early arrival times must be entered in the Admin Panel.`
                  : `Click to check in ${student.name}`
              }
            >
              {isCheckedIn ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <div className="text-left leading-tight">
                    <span className="block font-semibold">Checked In</span>
                    <span className="text-[10px] font-normal opacity-90">{record?.clockInTime}</span>
                  </div>
                </>
              ) : isBefore3PM ? (
                <>
                  <Lock className="w-3.5 h-3.5 text-amber-700" />
                  <span>Opens 3:00 PM</span>
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
              className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg font-medium text-xs transition-all ${
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
    </div>
  );
};
