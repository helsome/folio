import React from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useAtomValue } from 'jotai';
import { agentPanelVisibleAtom } from '../../atoms';
import { ErrorBoundary } from '../primitives/ErrorBoundary';
import { Sidebar } from './Sidebar';
import { FinanceWorkspace } from '../workspace/FinanceWorkspace';
import { AgentPanel } from '../agent/AgentPanel';

export const WorkbenchShell: React.FC = () => {
  const agentPanelVisible = useAtomValue(agentPanelVisibleAtom);

  return (
    <div className="relative h-full flex-1 overflow-hidden">
      <Allotment className="h-full">
        <Allotment.Pane minSize={200} preferredSize={250}>
          <Sidebar />
        </Allotment.Pane>
        <Allotment.Pane minSize={500}>
          <ErrorBoundary>
            <FinanceWorkspace />
          </ErrorBoundary>
        </Allotment.Pane>
        <Allotment.Pane
          minSize={320}
          preferredSize={400}
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
