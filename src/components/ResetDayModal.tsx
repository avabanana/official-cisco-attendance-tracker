import React, { useState } from 'react';
import { AlertTriangle, RotateCcw, X, Lock, CheckCircle2 } from 'lucide-react';

interface ResetDayModalProps {
  date: string;
  isOpen: boolean;
  isAdminUnlocked: boolean;
  onClose: () => void;
  onConfirmReset: (password?: string) => Promise<void>;
}

export const ResetDayModal: React.FC<ResetDayModalProps> = ({
  date,
  isOpen,
  isAdminUnlocked,
  onClose,
  onConfirmReset,
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  if (!isOpen) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAdminUnlocked && !password.trim()) {
      setError('Admin password is required to authorize reset.');
      return;
    }

    try {
      setIsResetting(true);
      setError(null);
      await onConfirmReset(password.trim());
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to reset records. Please verify admin credentials.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl border border-rose-200 shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Warning Strip */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-rose-600" />

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">
                Reset Records for Day
              </h3>
              <span className="inline-block mt-0.5 text-xs font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                {date}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-slate-600 mb-4 leading-relaxed">
          Are you sure you want to reset all attendance and laptop records for{' '}
          <strong className="text-slate-900 font-semibold">{date}</strong>?
        </p>

        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3 mb-4 space-y-1 text-xs text-rose-900">
          <p className="font-semibold flex items-center gap-1.5 text-rose-700">
            <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
            What will happen:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-rose-800 text-[11px] pl-1">
            <li>All club members will be set back to <strong>Absent</strong> for this day.</li>
            <li>All clock-in and clock-out timestamps for this day will be cleared.</li>
            <li>All laptop imaging counters logged for this day will be set to 0.</li>
            <li>Historical data recorded on other calendar days remains safe.</li>
          </ul>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleReset} className="space-y-4">
          {!isAdminUnlocked && (
            <div>
              <label
                htmlFor="reset-admin-password"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Admin Authorization Password
              </label>
              <div className="relative">
                <input
                  id="reset-admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder=""
                  autoFocus
                  className="w-full pl-3 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Required because admin is currently locked.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              id="btn-cancel-reset"
              type="button"
              onClick={onClose}
              disabled={isResetting}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-reset"
              type="submit"
              disabled={isResetting}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-[0.98] rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isResetting ? 'Resetting...' : `Yes, Reset ${date} Records`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
