import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { InvestmentThesis, ThesisStance } from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import {
  getImpactsForSymbol,
  getThesesForSymbol,
  researchReportAtomFamily,
  thesisImpactsAtom,
  thesesAtom,
} from '../../atoms/thesisAtoms';
import {
  loadImpacts,
  loadResearchReport,
  loadTheses,
  reEvaluateThesis,
  saveThesisFromReport,
} from '../../client/thesis';
import { Button } from '../primitives/Button';
import { ThesisEditor } from './ThesisEditor';
import { ThesisImpactList } from './ThesisImpactList';

const STANCE_BADGE: Record<ThesisStance, { label: string; color: string }> = {
  bullish: { label: 'Bullish', color: '#22c55e' },
  bearish: { label: 'Bearish', color: '#ef4444' },
  neutral: { label: 'Neutral', color: '#9ca3af' },
};

interface ThesisCardProps {
  thesis: InvestmentThesis;
  onReEvaluate: () => void;
  onEdit: () => void;
}

const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, onReEvaluate, onEdit }) => {
  const badge = STANCE_BADGE[thesis.stance];
  return (
    <div className="rounded-[10px] border border-foreground/8 p-3" data-testid="thesis-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: badge.color }}>
          {badge.label}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onReEvaluate}>
            Re-evaluate
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[13px] leading-relaxed text-foreground">{thesis.summary}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <PointList title="Bull" points={thesis.bullCase} tone="#22c55e" />
        <PointList title="Bear" points={thesis.bearCase} tone="#ef4444" />
        <PointList title="Catalysts" points={thesis.catalysts} tone="#3b82f6" />
        <PointList title="Risks" points={thesis.risks} tone="#f59e0b" />
      </div>

      <div className="mt-3 text-[11px] text-foreground/44">
        Last reviewed {new Date(thesis.lastReviewedAt).toLocaleDateString()}
      </div>
    </div>
  );
};

const PointList: React.FC<{ title: string; points: string[]; tone: string }> = ({ title, points, tone }) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone }}>
      {title}
    </div>
    {points.length === 0 ? (
      <div className="mt-0.5 text-[12px] text-foreground/38">—</div>
    ) : (
      <ul className="mt-0.5 list-inside list-disc space-y-0.5">
        {points.map((point, index) => (
          <li key={index} className="text-[12px] text-foreground/70">
            {point}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** Thesis cards for the active symbol + "Save as Thesis" when a report exists. */
export const ThesisPanel: React.FC = () => {
  const symbol = useAtomValue(activeSymbolAtom);
  const [theses, setTheses] = useAtom(thesesAtom);
  const [impacts, setImpacts] = useAtom(thesisImpactsAtom);
  const [report, setReport] = useAtom(researchReportAtomFamily(symbol ?? ''));
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastImpact, setLastImpact] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    const [loadedTheses, loadedImpacts, loadedReport] = await Promise.all([
      loadTheses(symbol),
      loadImpacts(symbol),
      loadResearchReport(symbol),
    ]);
    setTheses(loadedTheses);
    setImpacts((current) => ({ ...current, [symbol]: loadedImpacts }));
    setReport(loadedReport);
    setLoading(false);
  }, [symbol, setTheses, setImpacts, setReport]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!symbol) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[13px] text-foreground/44">
        Select a symbol to view its investment thesis.
      </div>
    );
  }
  const symbolTheses = getThesesForSymbol(theses, symbol);
  const symbolImpacts = getImpactsForSymbol(impacts, symbol);

  const handleSaveFromReport = async () => {
    const created = await saveThesisFromReport(symbol);
    if (created) setTheses((current) => [created, ...current.filter((t) => t.id !== created.id)]);
  };

  const handleReEvaluate = async (thesis: InvestmentThesis) => {
    const impact = await reEvaluateThesis(symbol);
    if (!impact) return;
    setImpacts((current) => ({
      ...current,
      [symbol]: [impact, ...(current[symbol] ?? [])],
    }));
    setTheses((current) => current.map((t) => (t.id === thesis.id ? impact.thesis : t)));
    setLastImpact(impact.id);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4" data-testid="thesis-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          Thesis
        </h3>
        {report && (
          <Button size="sm" onClick={handleSaveFromReport} disabled={loading}>
            Save as Thesis
          </Button>
        )}
      </div>

      {!report && (
        <div className="mb-3 rounded-[10px] border border-dashed border-foreground/12 p-3 text-[12px] text-foreground/54">
          No research report yet. Run Deep Research for {symbol} to save a thesis.
        </div>
      )}

      {loading && symbolTheses.length === 0 ? (
        <div className="h-24 animate-pulse rounded-[12px] bg-foreground/6" />
      ) : symbolTheses.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-foreground/44">No thesis saved.</div>
      ) : (
        <div className="space-y-3">
          {symbolTheses.map((thesis) =>
            editingId === thesis.id ? (
              <ThesisEditor
                key={thesis.id}
                thesis={thesis}
                onCancel={() => setEditingId(null)}
                onSaved={(saved) => {
                  setTheses((current) => current.map((t) => (t.id === saved.id ? saved : t)));
                  setEditingId(null);
                }}
              />
            ) : (
              <ThesisCard
                key={thesis.id}
                thesis={thesis}
                onReEvaluate={() => handleReEvaluate(thesis)}
                onEdit={() => setEditingId(thesis.id)}
              />
            )
          )}
        </div>
      )}

      {lastImpact && (
        <div className="mt-3 rounded-[10px] bg-foreground/6 p-3 text-[12px] text-foreground/70">
          Re-evaluation complete — see the impact below.
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          Re-evaluation history
        </h3>
        <ThesisImpactList impacts={symbolImpacts} />
      </div>
    </div>
  );
};
