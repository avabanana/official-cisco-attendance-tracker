import React, { useState } from 'react';
import { Lock, KeyRound, ShieldAlert, ArrowLeft, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

interface AdminPasswordLockProps {
  onUnlock: (password: string) => Promise<boolean> | boolean | void;
  onCancel: () => void;
}

export const AdminPasswordLock: React.FC<AdminPasswordLockProps> = ({ onUnlock, onCancel }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsVerifying(true);
    setError(null);
    try {
      const success = await onUnlock(password.trim());
      if (success === false) {
        setError('Incorrect admin password. Access denied.');
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication error. Please try again.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4 py-8">
      <div
        className={`w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 transition-transform ${
          isShaking ? 'animate-shake' : ''
        }`}
      >
        {/* Header Icon */}
        <div className="flex items-center justify-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
            <Lock className="w-7 h-7" />
          </div>
        </div>

        {/* Titles */}
        <div className="text-center mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Admin Dashboard Lock
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-xs mx-auto">
            This area contains club attendance records, proxy alerts, and CSV exports. Enter the admin password to continue.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-rose-700 text-xs font-medium animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-password-input"
              className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
            >
              Admin Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                id="admin-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Enter password..."
                autoFocus
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <button
              id="btn-submit-admin-unlock"
              type="submit"
              disabled={isVerifying || !password.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-white text-sm font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{isVerifying ? 'Authenticating...' : 'Unlock Admin Dashboard'}</span>
            </button>

            <button
              id="btn-cancel-admin-lock"
              type="button"
              onClick={onCancel}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-medium rounded-xl border border-slate-200 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Cancel & Back to Check-In</span>
            </button>
          </div>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>Administrator Access</span>
          <span className="flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-slate-400" />
            Protected Area
          </span>
        </div>
      </div>
    </div>
  );
};
