import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { activeBranchesAtom, activeBranchAtom, activeSessionIdAtom, switchBranchAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

interface BranchSwitcherProps {
  disabled?: boolean;
}

/** Compact branch selector kept beside the Copilot context, not in the chat transcript. */
export const BranchSwitcher: React.FC<BranchSwitcherProps> = ({ disabled = false }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const sessionId = useAtomValue(activeSessionIdAtom);
  const branches = useAtomValue(activeBranchesAtom);
  const activeBranch = useAtomValue(activeBranchAtom);
  const switchBranch = useSetAtom(switchBranchAtom);
  const [error, setError] = useState<string | null>(null);

  if (!sessionId || !activeBranch) return null;

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const branchId = event.target.value;
    if (!branchId || branchId === activeBranch.id || disabled) return;
    setError(null);
    const result = await switchBranch(client, sessionId, branchId);
    if (!result.ok) setError(result.error.message);
  };

  return (
    <div className="border-b mac-section-divider px-3 py-2" data-testid="branch-switcher">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
        <label htmlFor="agent-branch-select" className="text-[10px] font-semibold uppercase tracking-[.1em] text-foreground/44">
          {t('agent.branch.current')}
        </label>
        <select
          id="agent-branch-select"
          aria-label={t('agent.branch.switch')}
          value={activeBranch.id}
          onChange={(event) => void handleChange(event)}
          disabled={disabled || branches.length < 2}
          className="min-w-0 flex-1 rounded-[7px] border border-border bg-surface px-2 py-1 text-[11px] text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="mt-1 truncate text-[10px] text-destructive">{error}</div>}
    </div>
  );
};
