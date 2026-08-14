import React, { useRef, useState } from 'react';
import type { ImportSource, PortfolioImportDraft } from '@finagent/core';
import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';
import { parsePortfolioImport, confirmPortfolioImport } from '../../client/portfolioImport';
import { ImportDraftReview } from './ImportDraftReview';

/**
 * Portfolio import dialog (spec §43–49).
 *
 * Flow: pick a source (Paste | CSV file | Screenshot — coming soon) → parse in
 * the MAIN process (`import:parse`) → review the draft → confirm (`import:confirm`,
 * persists the manual portfolio). Parsing alone never persists anything
 * (spec §93); the dialog only calls the repository-backed confirm channel.
 */

type DialogStep = 'pick' | 'paste' | 'review';

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a portfolio is confirmed so the UI can refresh. */
  onImported: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({ open, onClose, onImported }) => {
  const [step, setStep] = useState<DialogStep>('pick');
  const [draft, setDraft] = useState<PortfolioImportDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('pick');
    setDraft(null);
    setError(null);
    setConfirmError(null);
    setConfirming(false);
    if (pasteRef.current) pasteRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runParse = async (source: ImportSource, text: string) => {
    setError(null);
    const parsed = await parsePortfolioImport(source, text);
    if (!parsed) {
      setError('Import parsing is not available in this build yet.');
      return;
    }
    setDraft(parsed);
    setStep('review');
  };

  const handlePaste = () => {
    const text = pasteRef.current?.value ?? '';
    if (text.trim() === '') {
      setError('Paste some holdings first, e.g. AAPL.US 100 180.5');
      return;
    }
    void runParse('paste', text);
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (text.trim() === '') {
        setError('The file is empty.');
        return;
      }
      void runParse('csv', text);
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const handleConfirm = async (name: string) => {
    if (!draft) return;
    setConfirming(true);
    setConfirmError(null);
    const portfolio = await confirmPortfolioImport(draft, name);
    setConfirming(false);
    if (!portfolio) {
      setConfirmError('Import failed — please try again.');
      return;
    }
    onImported();
    handleClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Import Portfolio" className="max-w-2xl">
      {step === 'pick' && (
        <div className="space-y-3">
          <p className="text-[13px] text-foreground/70">
            Add a manual portfolio from your own records. It stays separate from
            broker-synced accounts.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => setStep('paste')}>
              Paste holdings
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Import CSV file…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Button variant="secondary" disabled title="Coming soon">
              Screenshot (coming soon)
            </Button>
          </div>
        </div>
      )}

      {step === 'paste' && (
        <div className="space-y-3">
          <p className="text-[13px] text-foreground/70">
            Paste lines in one of these formats:
          </p>
          <pre className="rounded-[10px] bg-foreground/4 px-3 py-2 text-[11px] text-foreground/60">
            {'AAPL.US 100 180.5\nAAPL.US, 100, 180.5\nAAPL.US 180.5'}
          </pre>
          <textarea
            ref={pasteRef}
            defaultValue=""
            placeholder="e.g. 0700.HK 500 320&#10;TSLA.US, 20, 245.5"
            rows={6}
            className="w-full rounded-[10px] border border-[var(--mac-border)] bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28"
          />
          {error && (
            <div className="rounded-[10px] bg-[var(--mac-red)]/12 px-3 py-2 text-[12px] text-foreground/80">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setStep('pick')}>
              Back
            </Button>
            <Button size="sm" onClick={handlePaste}>
              Parse
            </Button>
          </div>
        </div>
      )}

      {step === 'review' && draft && (
        <ImportDraftReview
          draft={draft}
          onCancel={handleClose}
          onConfirm={(name) => void handleConfirm(name)}
          confirming={confirming}
          confirmError={confirmError}
        />
      )}

      {step === 'review' && !draft && (
        <div className="space-y-3">
          {error && (
            <div className="rounded-[10px] bg-[var(--mac-red)]/12 px-3 py-2 text-[12px] text-foreground/80">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
