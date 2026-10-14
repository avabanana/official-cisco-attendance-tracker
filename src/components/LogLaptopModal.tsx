import React, { useState } from 'react';
import { X, Laptop, Plus, Check, Tag, FileText, CheckCircle2, History } from 'lucide-react';
import { AttendanceRecord, Student } from '../types';

interface LogLaptopModalProps {
  student: Student;
  record?: AttendanceRecord;
  onClose: () => void;
  onUpdateLaptops: (params: {
    studentId: string;
    delta?: number;
    setCount?: number;
    log?: {
      model?: string;
      assetTag?: string;
      notes?: string;
      count?: number;
    };
  }) => Promise<void>;
}

const COMMON_MODELS = [
  'Dell Latitude 5420',
  'Lenovo ThinkPad T480',
  'HP ProBook 450 G8',
  'Dell Latitude 5400',
  'Lenovo ThinkPad L14',
  'Acer Chromebook Spin',
];

export const LogLaptopModal: React.FC<LogLaptopModalProps> = ({
  student,
  record,
  onClose,
  onUpdateLaptops,
}) => {
  const currentCount = record?.laptopsImaged || 0;
  const [countToAdd, setCountToAdd] = useState<number>(1);
  const [model, setModel] = useState<string>('Dell Latitude 5420');
  const [customModel, setCustomModel] = useState<string>('');
  const [assetTag, setAssetTag] = useState<string>('');
  const [notes, setNotes] = useState<string>('Re-imaged & drivers installed');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'add' | 'history'>('add');

  const selectedModel = model === 'Other' ? customModel.trim() || 'Custom Laptop' : model;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countToAdd <= 0) return;

    setIsSubmitting(true);
    try {
      await onUpdateLaptops({
        studentId: student.id,
        delta: countToAdd,
        log: {
          model: selectedModel,
          assetTag: assetTag.trim() || undefined,
          notes: notes.trim() || undefined,
          count: countToAdd,
        },
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickAdd = async (quantity: number) => {
    setIsSubmitting(true);
    try {
      await onUpdateLaptops({
        studentId: student.id,
        delta: quantity,
        log: {
          model: selectedModel,
          count: quantity,
          notes: 'Quick logged',
        },
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const logs = record?.laptopLogs || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base leading-tight">
                Log Imaged Laptops
              </h3>
              <p className="text-xs text-slate-500">
                {student.name} • <span className="font-semibold text-indigo-700">{currentCount} imaged this session</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher: Add vs History */}
        <div className="flex border-b border-slate-100 bg-slate-50/40 px-5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveSubTab('add')}
            className={`py-2.5 px-3 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'add'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Laptops</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('history')}
            className={`py-2.5 px-3 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'history'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Session Logs ({logs.length})</span>
          </button>
        </div>

        {activeSubTab === 'add' ? (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            
            {/* Quick Increment Bar */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Quick Add:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickAdd(1)}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl font-semibold text-xs transition-all active:scale-[0.98]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+1 Laptop</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAdd(2)}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl font-semibold text-xs transition-all active:scale-[0.98]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+2 Laptops</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAdd(3)}
                  disabled={isSubmitting}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl font-semibold text-xs transition-all active:scale-[0.98]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+3 Laptops</span>
                </button>
              </div>
            </div>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Or enter details
              </span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* Quantity Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Number of Laptops Imaged
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={countToAdd}
                  onChange={(e) => setCountToAdd(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 px-3 py-2 text-sm font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
                <span className="text-xs text-slate-500">
                  New session total will be: <strong className="text-indigo-700">{currentCount + countToAdd}</strong>
                </span>
              </div>
            </div>

            {/* Laptop Model */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Laptop Model / Type
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {COMMON_MODELS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setModel(item)}
                    className={`text-left px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      model === item
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Or custom model (e.g., MacBook, Surface Pro, Dell OptiPlex)..."
                  value={customModel}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    setModel('Other');
                  }}
                  className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
              </div>
            </div>

            {/* Asset Tag / Serial */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-slate-400" />
                <span>Asset Tag / Serial # (Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g., TAG-8492 or serial number"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Notes / Checklist (Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. BIOS flashed, Windows 11 deployed, asset tag applied"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-all active:scale-[0.98] cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Log {countToAdd} Laptop{countToAdd > 1 ? 's' : ''}</span>
              </button>
            </div>

          </form>
        ) : (
          <div className="p-5 space-y-3 max-h-[380px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No individual laptop entries recorded for this session yet.
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <Laptop className="w-3.5 h-3.5 text-indigo-600" />
                        {log.model || 'Club Laptop'}
                      </span>
                      <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        +{log.count}
                      </span>
                    </div>
                    {log.assetTag && (
                      <div className="text-slate-500 font-mono text-[11px]">
                        Tag: {log.assetTag}
                      </div>
                    )}
                    {log.notes && (
                      <div className="text-slate-600 text-[11px]">
                        {log.notes}
                      </div>
                    )}
                    <div className="text-[10px] text-slate-400 pt-0.5">
                      Logged at {log.timeFormatted}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
