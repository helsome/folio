import React, { useEffect, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="relative bg-[oklch(var(--bg-primary))] rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
      >
        {title && (
          <h2 className="text-lg font-semibold mb-4">{title}</h2>
        )}
        {children}
        <button
          className="absolute top-4 right-4 text-[oklch(var(--text-secondary))] hover:text-[oklch(var(--text-primary))]"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
};