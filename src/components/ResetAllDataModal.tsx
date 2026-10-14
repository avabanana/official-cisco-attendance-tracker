import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Lock, ShieldAlert } from 'lucide-react';

interface ResetAllDataModalProps {
  isOpen: boolean;
  isAdminUnlocked: boolean;
  onClose: () => void;
  onConfirmResetAll: (password?: string) => Promise<void>;
}

export const ResetAllDataModal: React.FC<ResetAllDataModalProps> = ({
  isOpen,
  isAdminUnlocked,
  onClose,
  onConfirmResetAll,
}) => {
  const [password, setPassword] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  if (!isOpen) return null;

  const isConfirmed = confirmationPhrase.trim().toUpperCase() === 'RESET ALL';

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConfirmed) {
      setError('Please type "RESET ALL" in all caps to confirm.');
      return;
    }

    if (!isAdminUnlocked && !password.trim()) {
      setError('Admin password is required to authorize complete system reset.');
      return;
    }

    try {
      setIsResetting(true);
      setError(null);
      await onConfirmResetAll(password.trim());
      setPassword('');
      setConfirmationPhrase('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to reset all site data. Please verify admin password.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl border border-red-300 shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Destructive Warning Strip */}
        <div className="absolute top-0 inset-x-0 h-2 bg-red-600" />

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-100 border border-red-300 flex items-center justify-center text-red-600 shrink-0">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">
                Factory Reset All Site Data
              </h3>
              <p className="text-xs text-red-700 font-medium mt-0.5">
                Permanent Action • Cannot Be Undone
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

        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-4 space-y-2 text-xs text-red-950">
          <p className="font-bold flex items-center gap-1.5 text-red-800">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            Everything that will be completely wiped:
          </p>
          <ul className="list-disc list-inside space-y-1 text-red-900 text-[11px] pl-1 leading-relaxed">
            <li>
              <strong>All-Time Laptops Imaged:</strong> Every student's cumulative laptop count and the club goal progress will be wiped to <strong>0</strong>.
            </li>
            <li>
              <strong>All Historical Attendance:</strong> Every previous meeting's attendance records across all dates will be deleted.
            </li>
            <li>
              <strong>Imaging Logs & Serial Tags:</strong> All laptop image log entries, asset tags, and model notes will be removed.
            </li>
            <li>
              <strong>Anti-Proxy Security Alerts:</strong> All alert logs and flagged history will be cleared.
            </li>
            <li>
              <strong>Clean Slate Re-initialization:</strong> Today's session will reset to a clean roster of members set to Absent.
            </li>
          </ul>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label
              htmlFor="confirm-phrase-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Type <span className="font-mono font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">RESET ALL</span> to confirm:
            </label>
            <input
              id="confirm-phrase-input"
              type="text"
              value={confirmationPhrase}
              onChange={(e) => {
                setConfirmationPhrase(e.target.value);
                if (error) setError(null);
              }}
              placeholder="RESET ALL"
              autoFocus
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 font-mono font-bold uppercase tracking-wider"
            />
          </div>

          {!isAdminUnlocked && (
            <div>
              <label
                htmlFor="reset-all-admin-password"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Admin Authorization Password
              </label>
              <div className="relative">
                <input
                  id="reset-all-admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter admin password"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 font-mono"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              id="btn-cancel-reset-all"
              type="button"
              onClick={onClose}
              disabled={isResetting}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-reset-all"
              type="submit"
              disabled={isResetting || !isConfirmed}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isResetting ? 'Wiping All Data...' : 'Permanently Reset All Site Data'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
