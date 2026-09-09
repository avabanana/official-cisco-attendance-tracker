import React, { useState } from 'react';
import { X, Clock, AlertTriangle, Save, RotateCcw } from 'lucide-react';
import { AttendanceRecord } from '../types';

interface EditRecordModalProps {
  record: AttendanceRecord;
  onClose: () => void;
  onSave: (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
  }) => Promise<void>;
  onReset: (studentId: string) => Promise<void>;
}

export const EditRecordModal: React.FC<EditRecordModalProps> = ({
  record,
  onClose,
  onSave,
  onReset,
}) => {
  const [clockInTime, setClockInTime] = useState(record.clockInTime || '');
  const [clockOutTime, setClockOutTime] = useState(record.clockOutTime || '');
  const [isFlagged, setIsFlagged] = useState(record.isFlagged);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        studentId: record.studentId,
        clockInTime: clockInTime.trim() || null,
        clockOutTime: clockOutTime.trim() || null,
        isFlagged,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetRecord = async () => {
    if (confirm(`Reset attendance for "${record.studentName}"? This will clear clock-in and clock-out for today.`)) {
      setIsSaving(true);
      try {
        await onReset(record.studentId);
        onClose();
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Adjust Attendance Record</h3>
            <p className="text-xs text-slate-500">{record.studentName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Clock In Time
            </label>
            <div className="relative">
              <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
                placeholder="e.g. 03:15:00 PM (or leave empty)"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Leave empty to mark as not checked in</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Clock Out Time
            </label>
            <div className="relative">
              <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={clockOutTime}
                onChange={(e) => setClockOutTime(e.target.value)}
                placeholder="e.g. 05:00:00 PM (or leave empty)"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Flag Toggle */}
          <div className="pt-2 border-t border-slate-100">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isFlagged}
                onChange={(e) => setIsFlagged(e.target.checked)}
                className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
              />
              <div>
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Flagged for Administrative Review
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Keep flagged if proxy check-in or suspicious activity occurred.
                </span>
              </div>
            </label>
          </div>

          {/* Action buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleResetRecord}
              disabled={isSaving}
              className="px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg border border-rose-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Entry
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>

      </div>
    </div>
  );
};
