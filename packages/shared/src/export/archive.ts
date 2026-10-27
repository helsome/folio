import type { EvidenceBundle, ResearchReport } from '@finagent/core';
import { buildReportEvidenceBundle } from '../evidence/contract.ts';
import { redact } from '../diagnostics/redact.ts';
import { redactForShare } from './privacy.ts';

export interface ResearchReportArchive {
  schemaVersion: 'folio-research-archive/v1';
  report: ResearchReport;
  evidence: EvidenceBundle;
}

/** Export the public report contract and its existing evidence projection. */
export function reportToJson(report: ResearchReport): string {
  // 明确选择公开字段，避免把运行时附加的配置或凭据序列化。
  const publicReport: ResearchReport = {
    id: report.id,
    symbol: report.symbol,
    instrumentId: report.instrumentId,
    generatedAt: report.generatedAt,
    strategyId: report.strategyId,
    locale: report.locale,
    summary: report.summary,
    stance: report.stance,
    confidence: report.confidence,
    sections: report.sections.map((section) => ({
      key: section.key,
      title: section.title,
      verdict: section.verdict,
      summary: section.summary,
      evidence: section.evidence.map((ref) => ({
        capabilityId: ref.capabilityId,
        runId: ref.runId,
        claim: ref.claim,
        fetchedAt: ref.fetchedAt,
        summary: ref.summary,
        instrumentId: ref.instrumentId,
      })),
    })),
    bullCase: report.bullCase,
    bearCase: report.bearCase,
    catalysts: report.catalysts,
    risks: report.risks,
    capabilityRuns: report.capabilityRuns.map((run) => ({
      runId: run.runId,
      capabilityId: run.capabilityId,
      status: run.status,
      fetchedAt: run.fetchedAt,
      marketTime: run.marketTime,
      error: run.error,
    })),
    runStatus: report.runStatus,
  };
  const sharedReport = redactForShare(publicReport);
  const archive = {
    schemaVersion: 'folio-research-archive/v1',
    report: sharedReport,
    evidence: buildReportEvidenceBundle(sharedReport),
  } satisfies ResearchReportArchive;
  // 在字符串值上复用现有脱敏规则，保留 JSON 编码和引用结构。
  return `${JSON.stringify(archive, (_key, value: unknown) =>
    typeof value === 'string' ? redact(value) : value, 2)}\n`;
}
