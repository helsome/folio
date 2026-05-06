import React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-foreground/70">
            {label}
          </label>
        )}
        <input
          className={cn(
            "mac-input px-3 py-2 rounded-[10px] text-[13px] text-foreground placeholder:text-foreground/38",
            "focus:outline-none focus:ring-2 focus:ring-accent/28 focus:border-[rgba(var(--accent-rgb),0.34)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-smooth",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
