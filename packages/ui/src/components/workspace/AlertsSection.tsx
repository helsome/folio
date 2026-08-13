import React from 'react';
import { AlertList } from '../alert/AlertList';

/**
 * Alerts app section. AlertList mounts the full alert management surface,
 * including the AlertForm used to create new alerts.
 */
export const AlertsSection: React.FC = () => {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AlertList />
    </div>
  );
};
