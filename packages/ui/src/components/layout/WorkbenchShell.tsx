import React, { useEffect, useState } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useAtomValue } from 'jotai';
import { agentPanelVisibleAtom } from '../../atoms';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { ErrorBoundary } from '../primitives/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { FinanceWorkspace } from '../workspace/FinanceWorkspace';
import { AgentPanel } from '../agent/AgentPanel';

const SIZES_KEY = 'allotmentSizes';
const DEFAULT_SIZES = [250, 640, 400];

export const WorkbenchShell: React.FC = () => {
  const agentPanelVisible = useAtomValue(agentPanelVisibleAtom);
  const [sizes, setSizes] = useState<number[]>(() => readPersisted<number[]>(SIZES_KEY, DEFAULT_SIZES));

  // Keep persisted sizes sane: always three panes, positive values.
  const normalized = sizes.length === 3 && sizes.every((s) => Number.isFinite(s) && s > 0)
    ? sizes
    : DEFAULT_SIZES;

  const handleDragEnd = (next: number[]): void => {
    setSizes(next);
    writePersisted(SIZES_KEY, next);
  };

  // When the agent panel toggles off and back on, Allotment restores its
  // remembered width automatically; no extra state required.

  return (
    <div className="relative h-full flex-1 overflow-hidden">
      <Allotment className="h-full" defaultSizes={normalized} onDragEnd={handleDragEnd}>
        <Allotment.Pane minSize={200} preferredSize={normalized[0]}>
          <Sidebar />
        </Allotment.Pane>
        <Allotment.Pane minSize={500}>
          <ErrorBoundary>
            <FinanceWorkspace />
          </ErrorBoundary>
        </Allotment.Pane>
        <Allotment.Pane
          minSize={320}
          preferredSize={normalized[2]}
          snap
          visible={agentPanelVisible}
        >
          <ErrorBoundary>
            <AgentPanel />
          </ErrorBoundary>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
};
