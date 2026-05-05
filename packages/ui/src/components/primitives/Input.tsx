import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  ...props
}) => {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-[oklch(var(--text-secondary))]">
          {label}
        </label>
      )}
      <input
        className={`px-3 py-2 rounded-lg border border-[oklch(var(--bg-secondary))] bg-[oklch(var(--bg-primary))] text-[oklch(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-[oklch(var(--accent-primary))] ${className}`}
        {...props}
      />
      {error && (
        <span className="text-sm text-red-500">{error}</span>
      )}
    </div>
  );
};