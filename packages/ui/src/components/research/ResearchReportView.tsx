import React, { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { ResearchReport, ResearchSection } from '@finagent/core';
import { loadResearchDiff, researchDiffAtom } from '../../atoms/diffAtoms';
import { loadResearchReport } from '../../atoms/researchAtoms';
import { EvidenceList } from './EvidenceList';
import { ExportMenu } from './ExportMenu';
import { WhatChangedSection } from './WhatChangedSection';
import { MarkdownContent } from '../chat/MarkdownContent';

const STANCE_TONE: Record<ResearchReport['stance'], string> = {
  bullish: 'text-positive',
  bearish: 'text-negative',
  neutral: 'text-text-muted',
};

const VERDICT_TONE: Record<ResearchSection['verdict'], string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-muted',
  unavailable: 'text-warning',
};

/** Full Deep Research report: stance, sections, cases, catalysts, risks, evidence. */
export const ResearchReportView: React.FC<{
  report: ResearchReport;
  nextAction?: React.ReactNode;
}> = ({ report, nextAction }) => {
  const { t } = useTranslation();
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
    <div className="folio-pilot-report" data-testid="research-report">
      <div className="folio-pilot-verdict">
        <div className="folio-pilot-verdict-top">
          <div>
            <div className="folio-pilot-verdict-label">
              {t('research.reportFor', { symbol: report.symbol })}
            </div>
            <h3 className={`mt-1 text-[17px] font-bold ${STANCE_TONE[report.stance]}`}>
              {t(`research.stance.${report.stance}`)}
            </h3>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="folio-pilot-verdict-label">
                {t('research.confidence')}
              </div>
              <div className="folio-pilot-confidence">
                {confidence}%
              </div>
            </div>
            <ExportMenu report={report} />
          </div>
        </div>
        <MarkdownContent content={report.summary} className="folio-pilot-summary" />
        <div className="folio-pilot-report-meta">
          {report.runStatus === 'partial'
            ? t('research.partialRun')
            : t('research.allCompleted')}{' '}
          · {t('research.capabilityCalls', { count: report.capabilityRuns.length })} ·{' '}
          {new Date(report.generatedAt).toLocaleString()}
        </div>
        {nextAction}
      </div>

      {diffState.diff && (
        <WhatChangedSection
          diff={diffState.diff}
          previousReport={previousReport ?? undefined}
        />
      )}

      <div id="research-signals" className="folio-pilot-report-sections">
        {report.sections.map((section) => (
          <SectionCard key={section.key} section={section} />
        ))}
      </div>

      <CaseColumn title={t('research.bullCase')} points={report.bullCase} />
      <CaseColumn title={t('research.bearCase')} points={report.bearCase} />
      <CaseColumn title={t('research.catalysts')} points={report.catalysts} />
      <CaseColumn title={t('research.risks')} points={report.risks} />

      <section id="research-evidence-detail" className="folio-pilot-evidence">
        <h4 className="folio-pilot-evidence-heading">
          {t('research.evidence')}
        </h4>
        <p className="folio-pilot-evidence-note">
          {t('research.evidenceNote')}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {report.sections.map((section) => (
            <EvidenceList key={section.key} section={section} />
          ))}
        </div>
      </section>
    </div>
  );
};

const SectionCard: React.FC<{ section: ResearchSection }> = ({ section }) => {
  const { t } = useTranslation();
  return (
    <article className="folio-pilot-report-section">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-foreground">{section.title}</span>
        <span className={`text-[11px] font-semibold ${VERDICT_TONE[section.verdict]}`}>
          {t(`research.verdict.${section.verdict}`)}
        </span>
      </div>
      <MarkdownContent content={section.summary} className="folio-pilot-report-section-summary" />
      {section.evidence.length > 0 && (
        <div className="mt-1.5 text-[10.5px] text-text-muted">
          {t(
            section.evidence.length === 1
              ? 'research.evidenceSourceCount'
              : 'research.evidenceSourceCountOther',
            { count: section.evidence.length }
          )}
        </div>
      )}
    </article>
  );
};

const CaseColumn: React.FC<{ title: string; points: string[] }> = ({ title, points }) => {
  if (points.length === 0) return null;
  return (
    <section className="folio-pilot-case">
      <h4>
        {title}
      </h4>
      <ul className="mt-2 flex flex-col gap-1.5">
        {points.map((point, index) => (
          <li key={index} className="text-[12.5px] leading-relaxed text-foreground/80">
            <span className="mr-1.5 text-text-muted">•</span>
            <MarkdownContent content={point} className="inline text-[12.5px] text-foreground/80" />
          </li>
        ))}
      </ul>
    </section>
  );
};
