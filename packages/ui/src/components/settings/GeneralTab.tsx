import React from 'react';
import { useAtom } from 'jotai';
import { llmStateAtom } from '../../atoms';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useTheme, type ThemeMode } from '../layout/ThemeProvider';

/** Minimal, real app + agent-runtime information. */
export const GeneralTab: React.FC = () => {
  const [state] = useAtom(llmStateAtom);
  const { mode, setMode } = useTheme();
  const model = state.model;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Application', value: 'Folio' },
    { label: 'Agent runtime', value: state.runtimeProvider },
    { label: 'Streaming', value: state.isStreaming ? 'Enabled' : 'Disabled' },
    { label: 'Active model', value: model ? (model.name || `${model.provider}/${model.id}`) : '—' },
    { label: 'Thinking level', value: state.thinkingLevel },
  ];

  return (
    <div className="max-w-2xl">
      <div className="space-y-4">
      <div className="mac-stock-tile rounded-[12px] p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-foreground">Application</h2>
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4">
              <dt className="text-[13px] text-foreground/54">{row.label}</dt>
              <dd className="text-right text-[13px] font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mac-stock-tile rounded-[12px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-[14px] font-semibold text-foreground">Appearance</h2><p className="mt-1 text-[12px] text-foreground/48">Choose how Folio follows your desktop theme.</p></div>
          <div className="w-36"><Select value={mode} onValueChange={(value) => setMode(value as ThemeMode)}><SelectTrigger aria-label="Theme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select></div>
        </div>
      </div>
      </div>
    </div>
  );
};
