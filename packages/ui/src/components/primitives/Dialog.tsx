import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
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
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-index-modal) bg-black/32 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-(--z-index-modal) w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-border bg-surface p-5 text-foreground shadow-[0_16px_40px_rgba(15,23,42,.14)]',
            'focus:outline-none',
            className
          )}
        >
          {title && <DialogPrimitive.Title className="mb-4 pr-8 text-[16px] font-semibold">{title}</DialogPrimitive.Title>}
          <DialogPrimitive.Description className="sr-only">{title ?? 'Folio dialog'}</DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-foreground/48 transition-colors hover:bg-surface-hover hover:text-foreground"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
};
