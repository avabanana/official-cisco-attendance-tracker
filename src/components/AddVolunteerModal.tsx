import React, { useState } from 'react';
import { UserPlus, X, AlertCircle, CheckCircle2, Clock, Shield } from 'lucide-react';
import { Student } from '../types';

interface AddVolunteerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddVolunteer: (data: {
    firstName: string;
    lastName: string;
    clockInNow?: boolean;
  }) => Promise<void>;
  existingRoster: Student[];
}

export const AddVolunteerModal: React.FC<AddVolunteerModalProps> = ({
  isOpen,
  onClose,
  onAddVolunteer,
  existingRoster,
}) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [clockInNow, setClockInNow] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const formattedPreview =
    trimmedLast && trimmedFirst
      ? `${trimmedLast}, ${trimmedFirst}`
      : (trimmedLast || trimmedFirst);

  // Check if name already exists in roster
  const isDuplicate = formattedPreview
    ? existingRoster.some(
        (s) => s.name.toLowerCase() === formattedPreview.toLowerCase()
      )
    : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedFirst && !trimmedLast) {
      setError('Please enter the volunteer\'s name.');
      return;
    }
    if (isDuplicate) {
      setError(`A volunteer named "${formattedPreview}" is already in the roster.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onAddVolunteer({
        firstName: trimmedFirst,
        lastName: trimmedLast,
        clockInNow,
      });
      // Reset form
      setFirstName('');
      setLastName('');
      setClockInNow(false);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add volunteer. Please try again.');
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
        className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative Top Accent Bar */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-indigo-600" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          title="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              Add New Volunteer
            </h3>
            <p className="text-xs text-slate-500">
              Appends a student volunteer to the club roster without affecting existing data
            </p>
          </div>
        </div>

        {/* Safe Preservation Notice */}
        <div className="mb-4 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-900 text-xs flex items-start gap-2.5">
          <Shield className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Data Safe:</span> All previous session records, attendance history, and all-time laptop counts are completely preserved.
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="new-vol-first-name"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1"
              >
                First Name
              </label>
              <input
                id="new-vol-first-name"
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Maya"
                autoFocus
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="new-vol-last-name"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1"
              >
                Last Name
              </label>
              <input
                id="new-vol-last-name"
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Patel"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          {/* Formatted Roster Preview */}
          {formattedPreview && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
              <span className="text-slate-500">Roster Display Format:</span>
              <span className={`font-mono font-semibold ${isDuplicate ? 'text-rose-600' : 'text-slate-900'}`}>
                {formattedPreview}
                {isDuplicate && ' (Already exists)'}
              </span>
            </div>
          )}

          {/* Quick Option: Clock In Now */}
          <div className="pt-1">
            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition-colors">
              <input
                type="checkbox"
                checked={clockInNow}
                onChange={(e) => setClockInNow(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-600" />
                  Clock In Immediately for Today
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Check this volunteer in right now as active for today's session.
                </p>
              </div>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              id="btn-submit-add-volunteer"
              type="submit"
              disabled={isSubmitting || (!trimmedFirst && !trimmedLast) || isDuplicate}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Volunteer</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
