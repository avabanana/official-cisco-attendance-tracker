import React, { useState, useMemo } from 'react';
import { X, Clock, ShieldCheck, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { AttendanceRecord } from '../types';

interface CutoffExceptionModalProps {
  isOpen: boolean;
  record: AttendanceRecord | null;
  onClose: () => void;
  onApproveException: (params: {
    studentId: string;
    actualTime: string;
    notes?: string;
  }) => Promise<void>;
}

export const CutoffExceptionModal: React.FC<CutoffExceptionModalProps> = ({
  isOpen,
  record,
  onClose,
  onApproveException,
}) => {
  if (!isOpen || !record) return null;

  const initialTime = record.actualCheckoutTime || record.clockOutTime || '05:00:00 PM';
  const [actualTime, setActualTime] = useState<string>(initialTime);
  const [notes, setNotes] = useState<string>(
    record.exceptionNote || 'Overtime volunteering approved by club advisor.'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to parse time string like "05:15:00 PM" into total minutes from midnight
  const parseTimeToMinutes = (t: string): number | null => {
    const match = t.match(/(\d+):(\d+):?(\d+)?\s*(AM|PM)?/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const meridiem = match[4]?.toUpperCase();
    if (meridiem === 'PM' && h < 12) h += 12;
    if (meridiem === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  };

  const clockInMinutes = record.clockInTime ? parseTimeToMinutes(record.clockInTime) : null;
  const approvedMinutes = parseTimeToMinutes(actualTime);

  const calculatedDuration = useMemo(() => {
    if (clockInMinutes !== null && approvedMinutes !== null && approvedMinutes >= clockInMinutes) {
      const diff = approvedMinutes - clockInMinutes;
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      return { total: diff, formatted: `${hours}h ${mins}m (${diff} minutes)` };
    }
    return null;
  }, [clockInMinutes, approvedMinutes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actualTime.trim()) {
      setError('Please enter the actual time the member stopped volunteering.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onApproveException({
        studentId: record.studentId,
        actualTime: actualTime.trim(),
        notes: notes.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to approve exception. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-amber-300 shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent Strip */}
        <div className="absolute top-0 inset-x-0 h-2 bg-amber-500" />

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0">
              <ShieldCheck className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 leading-tight">
                4:45 PM Volunteering Cut-Off Exception
              </h3>
              <p className="text-xs text-slate-600 font-medium mt-0.5">
                Grant overtime hours exception for <strong className="text-slate-900">{record.studentName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Card */}
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 mb-4 text-xs text-amber-950 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Late Check-Out Flagged</span>
          </div>
          <p className="text-amber-900 text-[11px] leading-relaxed">
            By club rule, all volunteering hours must be cut off by <strong>4:45 PM</strong>. This student attempted checkout after 4:45 PM, so their hours were automatically capped at 4:45 PM and flagged in the system.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-amber-200/70 text-[11px]">
            <div>
              <span className="text-amber-700 block text-[10px] font-semibold uppercase">Clock-In Time:</span>
              <span className="font-mono font-bold text-slate-800">{record.clockInTime || 'Not recorded'}</span>
            </div>
            <div>
              <span className="text-amber-700 block text-[10px] font-semibold uppercase">Attempted Checkout:</span>
              <span className="font-mono font-bold text-rose-700">
                {record.actualCheckoutTime || record.clockOutTime || 'After 4:45 PM'}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Actual Time Volunteering Stopped:
            </label>
            <div className="relative">
              <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="input-exception-time"
                type="text"
                value={actualTime}
                onChange={(e) => setActualTime(e.target.value)}
                placeholder="e.g. 05:15:00 PM"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none font-mono"
              />
            </div>

            {/* Quick preset buttons */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {record.actualCheckoutTime && (
                <button
                  type="button"
                  onClick={() => setActualTime(record.actualCheckoutTime!)}
                  className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                >
                  Use Attempted ({record.actualCheckoutTime})
                </button>
              )}
              <button
                type="button"
                onClick={() => setActualTime('05:00:00 PM')}
                className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                05:00 PM
              </button>
              <button
                type="button"
                onClick={() => setActualTime('05:15:00 PM')}
                className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                05:15 PM
              </button>
              <button
                type="button"
                onClick={() => setActualTime('05:30:00 PM')}
                className="px-2 py-1 text-[11px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-800 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              >
                05:30 PM
              </button>
            </div>
          </div>

          {/* Duration Preview */}
          {calculatedDuration && (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-center justify-between text-emerald-900">
              <span className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Recalculated Volunteering Credit:
              </span>
              <span className="font-bold font-mono text-emerald-800">{calculatedDuration.formatted}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Admin Exception Note / Justification:
            </label>
            <div className="relative">
              <FileText className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <textarea
                id="textarea-exception-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for approving hours past 4:45 PM (e.g. stayed late with advisor permission)"
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-approve-exception"
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:scale-[0.98] rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Approving...' : 'Approve Exception & Clear Flag'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
