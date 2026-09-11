import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FinancialEvidenceEnvelope, Message } from '@finagent/core';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Dialog } from '../primitives/Dialog';
import { DataFreshness } from '../primitives/DataFreshness';
import { collectCitationSources, type CitationIndex } from '../../lib/citations';

type SourceGroup = 'financial' | 'news' | 'document' | 'tool';

const GROUP_ORDER: SourceGroup[] = ['financial', 'news', 'document', 'tool'];

/**
 * Source Inspector (#30): the provenance surface for one assistant message.
 * Lists every citable origin (financial evidence envelopes, news/document
 * tool calls) and expands the selected one into its full evidence record —
 * values, lineage, redacted query, snapshot hash. Opened from the message
 * "Sources" affordance or by clicking any inline citation / block chip.
 */
export const SourceInspector: React.FC<{
  message: Message;
  /** Citation id to select when opening (from a clicked citation chip). */
  focusSourceId?: string;
  onClose: () => void;
}> = ({ message, focusSourceId, onClose }) => {
  const { t } = useTranslation();
  const index = useMemo(() => collectCitationSources(message), [message]);
  const envelopeById = useMemo(() => {
    const map = new Map<string, FinancialEvidenceEnvelope>();
    for (const envelope of message.financialEvidence ?? []) map.set(envelope.toolCallId, envelope);
    return map;
  }, [message]);

  const [selectedId, setSelectedId] = useState<string | undefined>(
    focusSourceId ?? index.sources[0]?.id
  );

  useEffect(() => {
    if (focusSourceId !== undefined) setSelectedId(focusSourceId);
  }, [focusSourceId]);

  const grouped = useMemo(() => groupSources(index), [index]);
  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const selectedEnvelope = selectedId ? envelopeById.get(selectedId) : undefined;

  return (
    <Dialog open onClose={onClose} title={t('agent.sources.title')} className="max-w-2xl">
      <div className="flex flex-col gap-3" data-testid="source-inspector">
        {index.sources.length === 0 ? (
          <p className="py-4 text-[12.5px] text-foreground/48">{t('agent.sources.empty')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {GROUP_ORDER.map((group) => {
              const sources = grouped.get(group);
              if (!sources || sources.length === 0) return null;
              return (
                <div key={group}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/46">
                    {t(`agent.sources.kind.${group}`, { count: sources.length })}
                  </div>
                  <div className="overflow-hidden rounded-[10px] border mac-list-row">
                    {sources.map((source) => {
                      const active = source.id === selectedId;
                      return (
                        <button
                          key={source.id}
                          type="button"
                          data-source-id={source.id}
                          onClick={() => setSelectedId(source.id)}
                          className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 transition-smooth ${
                            active ? 'bg-accent/10' : 'hover:bg-foreground/4'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">
                            {source.title ?? source.toolName}
                          </span>
                          {source.stale && (
                            <span className="shrink-0 rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                              {t('agent.sources.stale')}
                            </span>
                          )}
                          {source.provider && (
                            <span className="shrink-0 text-[10.5px] text-foreground/44">{source.provider}</span>
                          )}
                          {source.retrievedAt !== undefined && (
                            <DataFreshness updatedAtMs={source.retrievedAt} className="shrink-0" />
                          )}
                          <ChevronDown className={`h-3 w-3 shrink-0 text-foreground/34 transition-transform ${active ? 'rotate-180' : ''}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {selected && (
              <SourceDetails sourceId={selected.id} envelope={selectedEnvelope} />
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};

const SourceDetails: React.FC<{
  sourceId: string;
  envelope: FinancialEvidenceEnvelope | undefined;
}> = ({ sourceId, envelope }) => {
  const { t } = useTranslation();
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  if (!envelope) {
    // Non-financial origin (e.g. news): only the tool-call record backs it.
    return (
      <div className="rounded-[10px] border mac-list-row p-3" data-testid="source-details">
        <div className="font-mono text-[11px] text-foreground/60">{sourceId}</div>
        <p className="mt-1 text-[11.5px] text-foreground/52">{t('agent.sources.noEnvelope')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="source-details">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border mac-list-row px-3 py-2 text-[11.5px]">
        <span className="flex items-center gap-1 text-positive">
          <Check className="h-3 w-3" />
          {t('agent.sources.verified')}
        </span>
        {envelope.fallback && (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3 w-3" />
            {t('agent.sources.fallback', { from: envelope.fallback.from, to: envelope.fallback.to })}
          </span>
        )}
        <span className="font-mono text-foreground/54">{envelope.id}</span>
        <span className="font-mono text-foreground/34">{envelope.resultHash}</span>
      </div>

      {envelope.values.length > 0 && (
        <div className="rounded-[10px] border mac-list-row p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">
            {t('agent.sources.values')}
          </div>
          <div className="mt-1.5 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 font-mono text-[11px]">
            {envelope.values.slice(0, 12).map((value) => (
              <React.Fragment key={value.metric}>
                <span className="truncate text-foreground/70">{value.metric}</span>
                <span className="text-right text-foreground/86">{String(value.normalizedValue)}</span>
                <span className="text-foreground/40">{value.unit ?? value.currency ?? ''}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-[10px] border mac-list-row p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/46">
          {t('agent.sources.lineage')}
        </div>
        <ol className="mt-1.5 space-y-1 text-[11.5px] text-foreground/66">
          {envelope.lineage.map((step, stepIndex) => (
            <li key={stepIndex} className="flex gap-2">
              <span className="mt-0.5 font-mono text-[10px] uppercase text-accent/70">{step.kind}</span>
              <span className="min-w-0 flex-1">{step.description}</span>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={() => setSnapshotOpen((open) => !open)}
        className="flex items-center gap-1.5 self-start rounded-[8px] px-2 py-1 text-[11.5px] text-foreground/56 transition-smooth hover:bg-foreground/6 hover:text-foreground"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${snapshotOpen ? 'rotate-180' : ''}`} />
        {t('agent.sources.snapshot')}
      </button>
      {snapshotOpen && (
        <pre className="max-h-48 overflow-auto rounded-[10px] border mac-list-row bg-foreground/[0.03] p-3 font-mono text-[10.5px] leading-relaxed text-foreground/70">
          {JSON.stringify({ query: envelope.query, resultSnapshot: envelope.resultSnapshot }, null, 2)}
        </pre>
      )}
    </div>
  );
};

function groupSources(index: CitationIndex): Map<SourceGroup, CitationIndex['sources']> {
  const groups = new Map<SourceGroup, CitationIndex['sources']>();
  for (const source of index.sources) {
    const list = groups.get(source.kind) ?? [];
    list.push(source);
    groups.set(source.kind, list);
  }
  return groups;
}
