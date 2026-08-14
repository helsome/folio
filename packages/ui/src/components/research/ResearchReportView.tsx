import React, { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import type { ResearchReport, ResearchSection } from '@finagent/core';
import { loadResearchDiff, researchDiffAtom } from '../../atoms/diffAtoms';
import { loadResearchReport } from '../../atoms/researchAtoms';
import { EvidenceList } from './EvidenceList';
import { ExportMenu } from './ExportMenu';
import { WhatChangedSection } from './WhatChangedSection';

const STANCE_TONE: Record<ResearchReport['stance'], string> = {
  bullish: 'text-positive',
  bearish: 'text-negative',
  neutral: 'text-text-muted',
};

const STANCE_LABEL: Record<ResearchReport['stance'], string> = {
  bullish: 'POSITIVE',
  bearish: 'NEGATIVE',
  neutral: 'NEUTRAL',
};

const VERDICT_TONE: Record<ResearchSection['verdict'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-muted',
  unavailable: 'text-warning',
};

const VERDICT_LABEL: Record<ResearchSection['verdict'], string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
  unavailable: 'Unavailable',
};

/** Full Deep Research report: stance, sections, cases, catalysts, risks, evidence. */
export const ResearchReportView: React.FC<{ report: ResearchReport }> = ({ report }) => {
  const confidence = Math.round(report.confidence * 100);
  const [diffState, setDiffState] = useAtom(researchDiffAtom);
  const [previousReport, setPreviousReport] = useState<ResearchReport | null>(null);

  // Fetch the latest diff for this symbol; when a previous report exists the
  // What Changed section renders. Degrades to a hidden section when the
  // research:getDiff channel is unwired or the symbol has no history.
  useEffect(() => {
    let alive = true;
    setDiffState({ loading: true, diff: null });
    setPreviousReport(null);
    void loadResearchDiff(report.symbol).then((diff) => {
      if (!alive) return;
      setDiffState({ loading: false, diff: diff ?? null });
      if (diff) {
        void loadResearchReport(diff.previousReportId).then((prev) => {
          if (alive && prev) setPreviousReport(prev);
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [report.symbol, report.id, setDiffState]);

  return (
    <div className="flex flex-col gap-4" data-testid="research-report">
      <div className="rounded-[10px] border mac-list-row p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {report.symbol} · Research Report
            </div>
            <h3 className={`mt-1 text-[17px] font-bold ${STANCE_TONE[report.stance]}`}>
              {STANCE_LABEL[report.stance]}
            </h3>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Confidence
              </div>
              <div className="tnum mt-0.5 text-[16px] font-semibold text-foreground">
                {confidence}%
              </div>
            </div>
            <ExportMenu report={report} />
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">{report.summary}</p>
        <div className="mt-2 text-[11px] text-text-muted">
          {report.runStatus === 'partial'
            ? 'Partial run — unavailable data is marked explicitly.'
            : 'All planned capabilities completed.'}{' '}
          · {report.capabilityRuns.length} capability calls ·{' '}
          {new Date(report.generatedAt).toLocaleString()}
        </div>
      </div>

      {diffState.diff && (
        <WhatChangedSection
          diff={diffState.diff}
          previousReport={previousReport ?? undefined}
        />
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {report.sections.map((section) => (
          <SectionCard key={section.key} section={section} />
        ))}
      </div>

      <CaseColumn title="Bull Case" points={report.bullCase} />
      <CaseColumn title="Bear Case" points={report.bearCase} />
      <CaseColumn title="Catalysts" points={report.catalysts} />
      <CaseColumn title="Risks" points={report.risks} />

      <div className="rounded-[10px] border mac-list-row p-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-foreground">
          Evidence
        </h4>
        <p className="mt-1 text-[11.5px] text-text-muted">
          Every claim below is linked to the exact capability run that produced the data.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {report.sections.map((section) => (
            <EvidenceList key={section.key} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
};

const SectionCard: React.FC<{ section: ResearchSection }> = ({ section }) => (
  <div className="rounded-[10px] border mac-list-row p-3">
    <div className="flex items-center justify-between">
      <span className="text-[12.5px] font-semibold text-foreground">{section.title}</span>
      <span className={`text-[11px] font-semibold ${VERDICT_TONE[section.verdict]}`}>
        {VERDICT_LABEL[section.verdict]}
      </span>
    </div>
    <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/75">{section.summary}</p>
    {section.evidence.length > 0 && (
      <div className="mt-1.5 text-[10.5px] text-text-muted">
        {section.evidence.length} evidence source{section.evidence.length === 1 ? '' : 's'}
      </div>
    )}
  </div>
);

const CaseColumn: React.FC<{ title: string; points: string[] }> = ({ title, points }) => {
  if (points.length === 0) return null;
  return (
    <div className="rounded-[10px] border mac-list-row p-4">
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-foreground">
        {title}
      </h4>
      <ul className="mt-2 flex flex-col gap-1.5">
        {points.map((point, index) => (
          <li key={index} className="text-[12.5px] leading-relaxed text-foreground/80">
            <span className="mr-1.5 text-text-muted">•</span>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
};
