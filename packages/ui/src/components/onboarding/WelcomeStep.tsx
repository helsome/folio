import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { acceptDisclaimersAtom, disclaimersAcceptedAtom } from '../../atoms';
import { DISCLAIMERS } from './disclaimers';

/** Welcome + one-time disclaimers (spec §42). */
export const WelcomeStep: React.FC = () => {
  const [accepted] = useAtom(disclaimersAcceptedAtom);
  const accept = useSetAtom(acceptDisclaimersAtom);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold text-foreground">Welcome to Folio</h2>
        <p className="text-[13px] text-foreground/66">
          A few minutes of setup gets your market data and AI connected. You can skip any step and
          return later from Settings.
        </p>
      </div>

      <div className="space-y-2">
        {DISCLAIMERS.map((disclaimer) => (
          <div key={disclaimer.id} className="rounded-[10px] border mac-section-divider p-3">
            <div className="text-[12px] font-semibold text-foreground">{disclaimer.title}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/60">{disclaimer.body}</p>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 rounded-[10px] border mac-section-divider p-3">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => {
            if (event.target.checked) accept();
          }}
          className="accent-[var(--mac-blue)]"
          data-testid="disclaimer-accept"
        />
        <span className="text-[12px] text-foreground/72">
          I understand and accept these terms.
        </span>
      </label>
    </div>
  );
};
