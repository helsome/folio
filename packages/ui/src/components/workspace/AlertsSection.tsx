import React from 'react';
import { useAtomValue } from 'jotai';
import { activeSymbolAtom } from '../../atoms';
import { AlertList } from '../alert/AlertList';

/**
 * Alerts app section. AlertList mounts the full alert management surface,
 * including the AlertForm used to create new alerts. The active symbol (e.g.
 * from "Monitor this thesis") prefills the new-alert form so the user never
 * retypes a symbol they already selected (V9 §16–17).
 */
export const AlertsSection: React.FC = () => {
  const activeSymbol = useAtomValue(activeSymbolAtom);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AlertList initialSymbol={activeSymbol ?? ''} />
    </div>
  );
};
