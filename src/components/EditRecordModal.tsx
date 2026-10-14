import React, { useState } from 'react';
import { X, Clock, AlertTriangle, Save, RotateCcw, Laptop } from 'lucide-react';
import { AttendanceRecord } from '../types';

interface EditRecordModalProps {
  record: AttendanceRecord;
  onClose: () => void;
  onSave: (updatedData: {
    studentId: string;
    clockInTime: string | null;
    clockOutTime: string | null;
    isFlagged: boolean;
    laptopsImaged?: number;
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
  const [laptopsImaged, setLaptopsImaged] = useState(record.laptopsImaged || 0);
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
        laptopsImaged: Math.max(0, Number(laptopsImaged) || 0),
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Clock In Time
              </label>
              <span className="text-[11px] text-indigo-600 font-medium">
                Admin Entry / Early Override
              </span>
            </div>
            <div className="relative">
              <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
                placeholder="e.g. 02:30:00 PM or 03:00:00 PM (or leave empty)"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            {/* Quick Presets for Admin (specifically supporting early before 3 PM entry) */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] text-slate-500 font-semibold">Presets:</span>
              <button
                type="button"
                onClick={() => {
                  const nowStr = new Date().toLocaleTimeString('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                  });
                  setClockInTime(nowStr);
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-medium cursor-pointer transition-colors"
                title="Use current Pacific time"
              >
                Use Current Time
              </button>
              <button
                type="button"
                onClick={() => setClockInTime('02:00:00 PM')}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-medium cursor-pointer transition-colors"
                title="Allow 2:00 PM early check-in"
              >
                2:00 PM (Early)
              </button>
              <button
                type="button"
                onClick={() => setClockInTime('02:30:00 PM')}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-medium cursor-pointer transition-colors"
                title="Allow 2:30 PM early check-in"
              >
                2:30 PM (Early)
              </button>
              <button
                type="button"
                onClick={() => setClockInTime('02:45:00 PM')}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-medium cursor-pointer transition-colors"
                title="Allow 2:45 PM early check-in"
              >
                2:45 PM (Early)
              </button>
              <button
                type="button"
                onClick={() => setClockInTime('03:00:00 PM')}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-medium cursor-pointer transition-colors"
                title="Set standard 3:00 PM check-in"
              >
                3:00 PM
              </button>
            </div>

            <p className="text-[11px] text-slate-500 mt-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200 leading-relaxed">
              💡 <strong>Early Clock-In Authorization:</strong> Members cannot clock in before 3:00 PM on the kiosk. Admins can enter early arrival times (e.g. 2:30 PM) here to grant volunteer hours.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                Clock Out Time
              </label>
              {record.actualCheckoutTime && (
                <button
                  type="button"
                  onClick={() => {
                    setClockOutTime(record.actualCheckoutTime!);
                    setIsFlagged(false);
                  }}
                  className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                >
                  Apply Attempted Time ({record.actualCheckoutTime})
                </button>
              )}
            </div>
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
            {record.cutoffExceeded && (
              <p className="text-[11px] text-amber-700 mt-1 bg-amber-50 p-2 rounded border border-amber-200">
                ⚠️ Student attempted checkout at <strong>{record.actualCheckoutTime}</strong>, past the 4:45 PM cutoff. Setting the actual time here and saving will approve the exception and recalculate volunteering hours.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Laptops Imaged Today
            </label>
            <div className="relative">
              <Laptop className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="0"
                value={laptopsImaged}
                onChange={(e) => setLaptopsImaged(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Number of laptops successfully imaged this session</p>
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
