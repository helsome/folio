import React from 'react';
import { Switch } from '../ui/switch';

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
    <Switch
      checked={checked}
      onCheckedChange={() => onChange()}
      aria-label={label}
      aria-busy={loading}
      disabled={blocked}
      className={`h-6 w-10 ${
        checked
          ? 'data-[state=checked]:bg-primary'
          : 'data-[state=unchecked]:bg-foreground/18 data-[state=unchecked]:hover:bg-foreground/28'
      } ${loading ? 'animate-pulse' : ''}`}
    />
  );
};
