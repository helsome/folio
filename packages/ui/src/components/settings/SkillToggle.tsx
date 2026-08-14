import React from 'react';

export interface SkillToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** In-flight: shows a pulse and blocks interaction while preserving state. */
  loading?: boolean;
  /** Accessible label — announce the action, not just the state. */
  label: string;
}

/**
 * Enable/disable switch with explicit hover, pressed, disabled, and loading
 * states. Never a silent no-op: it is either actionable or visibly disabled.
 */
export const SkillToggle: React.FC<SkillToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  loading = false,
  label,
}) => {
  const blocked = disabled || loading;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={loading}
      disabled={blocked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mac-blue)] ${
        checked
          ? 'bg-[var(--mac-blue)] hover:bg-[var(--mac-blue-hover)]'
          : 'bg-foreground/18 hover:bg-foreground/28'
      } ${
        blocked
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer active:scale-95'
      } ${loading ? 'animate-pulse' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};
