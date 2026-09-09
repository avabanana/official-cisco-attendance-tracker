import React from 'react';
import { CheckCircle2, AlertTriangle, X, ShieldAlert } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message?: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg text-xs transition-all animate-in slide-in-from-bottom-3 duration-200 ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-100 border-emerald-800'
                : toast.type === 'warning'
                ? 'bg-amber-950/90 text-amber-100 border-amber-800'
                : toast.type === 'error'
                ? 'bg-rose-950/90 text-rose-100 border-rose-800'
                : 'bg-slate-900/90 text-slate-100 border-slate-700'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {toast.type === 'warning' && <ShieldAlert className="w-4 h-4 text-amber-400" />}
              {toast.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
              {toast.type === 'info' && <CheckCircle2 className="w-4 h-4 text-sky-400" />}
            </div>

            <div className="flex-1 min-w-0">
              <h5 className="font-bold text-white leading-tight">{toast.title}</h5>
              {toast.message && (
                <p className="mt-0.5 opacity-90 leading-normal">{toast.message}</p>
              )}
            </div>

            <button
              onClick={() => onDismiss(toast.id)}
              className="p-1 text-white/60 hover:text-white rounded shrink-0 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
