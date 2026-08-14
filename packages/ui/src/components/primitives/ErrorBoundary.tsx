import React from 'react';
import { useSetAtom } from 'jotai';
import { navSectionAtom, settingsTabAtom } from '../../atoms';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Optional navigation override for [Open Diagnostics]. Defaults to opening
   * Settings → Diagnostics via the workspace atoms — the Lead may pass a more
   * specific handler at the App root if a different entry point is preferred.
   */
  onOpenDiagnostics?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors in a subtree (spec §37) so a crash in one section
 * renders a fallback instead of blanking the whole app (release gate #6).
 * [Retry] clears the boundary state and re-renders the children.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface for the operator; the ErrorLog ring buffer is fed by the main
    // process, so this stays a renderer-side console signal only.
    console.error('Folio caught a renderer error:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback onRetry={this.reset} onOpenDiagnostics={this.props.onOpenDiagnostics} />
      );
    }
    return this.props.children;
  }
}

const ErrorFallback: React.FC<{
  onRetry: () => void;
  onOpenDiagnostics?: () => void;
}> = ({ onRetry, onOpenDiagnostics }) => {
  const setNavSection = useSetAtom(navSectionAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);

  const openDiagnostics = (): void => {
    if (onOpenDiagnostics) {
      onOpenDiagnostics();
      return;
    }
    setSettingsTab('diagnostics');
    setNavSection('settings');
  };

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="error-boundary-fallback"
    >
      <div className="text-[15px] font-semibold text-foreground">Something went wrong</div>
      <div className="max-w-md text-[12px] text-foreground/60">
        An unexpected error occurred in this section. Retry, or open Diagnostics to inspect the
        app state and export a support bundle.
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="outline" size="sm" onClick={openDiagnostics}>
          Open Diagnostics
        </Button>
      </div>
    </div>
  );
};
