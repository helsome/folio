import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { InvestmentThesis, ThesisStance } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
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
import { NextAction } from '../primitives/NextAction';
import { ThesisEditor } from './ThesisEditor';
import { ThesisImpactList } from './ThesisImpactList';

const STANCE_BADGE: Record<ThesisStance, { color: string }> = {
  bullish: { color: '#22c55e' },
  bearish: { color: '#ef4444' },
  neutral: { color: '#9ca3af' },
};

interface ThesisCardProps {
  thesis: InvestmentThesis;
  onReEvaluate: () => void;
  onEdit: () => void;
}

const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, onReEvaluate, onEdit }) => {
  const { t } = useTranslation();
  const badge = STANCE_BADGE[thesis.stance];
  return (
    <div
      className="rounded-[12px] border border-[#dfe5ed] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]"
      data-testid="thesis-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center rounded-[5px] border border-[#dfe5ed] bg-[#f7f9fc] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: badge.color }}
        >
          {t(`thesis.stance.${thesis.stance}`)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="text-[11px] text-[#68778c] hover:bg-[#f4f7fc] hover:text-foreground"
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReEvaluate}
            className="border-[#d8e0eb] text-[11px] text-foreground/75 hover:border-[#a9bce1] hover:bg-[#f4f7fc]"
          >
            {t('thesis.reEvaluate')}
          </Button>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-6 text-foreground">{thesis.summary}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PointList title={t('thesis.bull')} points={thesis.bullCase} tone="#22c55e" />
        <PointList title={t('thesis.bear')} points={thesis.bearCase} tone="#ef4444" />
        <PointList title={t('thesis.catalysts')} points={thesis.catalysts} tone="#3b82f6" />
        <PointList title={t('thesis.risks')} points={thesis.risks} tone="#f59e0b" />
      </div>

      <div className="mt-4 border-t border-[#edf0f4] pt-2.5 text-[10px] tabular-nums text-[#8792a3]">
        {t('thesis.lastReviewed', { date: new Date(thesis.lastReviewedAt).toLocaleDateString() })}
      </div>
    </div>
  );
};

const PointList: React.FC<{ title: string; points: string[]; tone: string }> = ({ title, points, tone }) => (
  <div className="border-l-2 pl-2.5" style={{ borderLeftColor: tone }}>
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: tone }}>
      {title}
    </div>
    {points.length === 0 ? (
      <div className="mt-0.5 text-[12px] text-foreground/38">—</div>
    ) : (
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {points.map((point, index) => (
          <li key={index} className="text-[12px] leading-5 text-foreground/70">
            {point}
          </li>
        ))}
      </ul>
    )}
  </div>
);

/** Thesis cards for the active symbol + "Save as Thesis" when a report exists. */
export const ThesisPanel: React.FC = () => {
  const { t } = useTranslation();
  const symbol = useAtomValue(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [theses, setTheses] = useAtom(thesesAtom);
  const [impacts, setImpacts] = useAtom(thesisImpactsAtom);
  const [report, setReport] = useAtom(researchReportAtomFamily(symbol ?? ''));
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastImpact, setLastImpact] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

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
    setJustSaved(false);
  }, [refresh]);

  if (!symbol) {
    return (
      <div data-testid="thesis-panel" className="flex h-full items-center justify-center bg-[#f6f8fb] p-4">
        <div className="mx-auto w-full max-w-sm rounded-[12px] border border-[#dfe5ed] bg-white p-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
          <div className="text-[15px] font-semibold text-foreground">{t('thesis.empty.title')}</div>
          <p className="mt-1 text-[12px] text-foreground/54">{t('thesis.empty.subtitle')}</p>
          <Button
            size="sm"
            className="mt-3 bg-[#0052ff] text-white hover:bg-[#0045d8]"
            onClick={() => setNavSection('research')}
          >
            {t('thesis.empty.goResearch')}
          </Button>
        </div>
      </div>
    );
  }
  const symbolTheses = getThesesForSymbol(theses, symbol);
  const symbolImpacts = getImpactsForSymbol(impacts, symbol);

  const handleSaveFromReport = async () => {
    const created = await saveThesisFromReport(symbol);
    if (created) {
      setTheses((current) => [created, ...current.filter((t) => t.id !== created.id)]);
      setJustSaved(true);
    }
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
    <div className="flex h-full flex-col overflow-y-auto bg-[#f6f8fb] p-4" data-testid="thesis-panel">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#dfe5ed] pb-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f8b9d]">
          {t('thesis.thesis')}
        </h3>
        {report && (
          <Button
            size="sm"
            onClick={handleSaveFromReport}
            disabled={loading}
            className="bg-[#0052ff] text-white hover:bg-[#0045d8]"
          >
            {t('thesis.saveAsThesis')}
          </Button>
        )}
      </div>

      {!report && (
        <div className="mb-3 rounded-[9px] border border-dashed border-[#cbd5e1] bg-white px-3 py-2.5 text-[12px] leading-5 text-foreground/54">
          {t('thesis.noReportFor', { symbol })}
        </div>
      )}

      {loading && symbolTheses.length === 0 ? (
        <div className="h-24 animate-pulse rounded-[10px] border border-[#dfe5ed] bg-white" />
      ) : symbolTheses.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#dfe5ed] bg-white py-8 text-center text-[13px] text-foreground/44">
          {t('thesis.noneSaved')}
        </div>
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
        <div className="mt-3 rounded-[9px] border border-[#cfe0ff] bg-[#eef4ff] px-3 py-2.5 text-[12px] leading-5 text-foreground/75">
          {t('thesis.reEvaluateComplete')}
        </div>
      )}

      {justSaved && (
        <div className="mt-3">
          <NextAction
            testId="thesis-next-action"
            primaryLabel={t('thesis.monitor')}
            onPrimary={() => setNavSection('alerts')}
            hint={t('thesis.monitoredHint')}
          />
        </div>
      )}

      <div className="mt-5 border-t border-[#dfe5ed] pt-4">
        <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7f8b9d]">
          {t('thesis.reEvaluationHistory')}
        </h3>
        <ThesisImpactList impacts={symbolImpacts} />
      </div>
    </div>
  );
};
