import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  children,
  className,
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
    <div className="fixed inset-0 z-(--z-index-modal) flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={cn(
          "relative bg-background rounded-xl shadow-middle max-w-md w-full mx-4 p-6",
          "border border-[oklch(var(--foreground)/0.08)]",
          className
        )}
      >
        {title && (
          <h2 className="text-lg font-semibold mb-4 text-foreground">{title}</h2>
        )}
        {children}
        <button
          className="absolute top-4 right-4 text-foreground/50 hover:text-foreground transition-colors"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4L12 12M12 4L4 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};
