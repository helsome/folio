import type { ResearchReport, ResearchRunSummary, ResearchStance } from '@finagent/core';
import type { JsonFileStore } from '../storage/json-file-store.ts';

/**
 * Deep Research persistence. Layout under the injected store root (which the
 * kernel host points at `userData`):
 *
 *   research/index.json            — per-symbol report summary index
 *   research/reports/<id>.json     — full ResearchReport
 *   research/runs.json             — ResearchRunSummary progress records
 */
const INDEX_FILE = 'research/index.json';
const RUNS_FILE = 'research/runs.json';
const reportFile = (id: string) => `research/reports/${id}.json`;

export interface ReportSummary {
  id: string;
  symbol: string;
  generatedAt: number;
  stance: ResearchStance;
  confidence: number;
}

interface IndexFile {
  reports: ReportSummary[];
}

interface RunsFile {
  runs: ResearchRunSummary[];
}

export class ResearchReportRepository {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore) {
    this.store = store;
  }

  async saveReport(report: ResearchReport): Promise<void> {
    await this.store.write(reportFile(report.id), report);
    const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
    const entry: ReportSummary = {
      id: report.id,
      symbol: report.symbol,
      generatedAt: report.generatedAt,
      stance: report.stance,
      confidence: report.confidence,
    };
    await this.store.write(INDEX_FILE, {
      reports: [entry, ...index.reports.filter((r) => r.id !== report.id)],
    });
  }

  async getReport(reportId: string): Promise<ResearchReport | undefined> {
    return this.store.read<ResearchReport | undefined>(reportFile(reportId), undefined);
  }

  async listBySymbol(symbol: string): Promise<ResearchReport[]> {
    const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
    const ids = index.reports.filter((r) => r.symbol === symbol).map((r) => r.id);
    const reports = await Promise.all(ids.map((id) => this.getReport(id)));
    return reports.filter((report): report is ResearchReport => report !== undefined);
  }

  async listSummaries(): Promise<ReportSummary[]> {
    const index = await this.store.read<IndexFile>(INDEX_FILE, { reports: [] });
    return index.reports;
  }

  async saveRunSummary(summary: ResearchRunSummary): Promise<void> {
    const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
    await this.store.write(RUNS_FILE, {
      runs: [summary, ...runs.runs.filter((r) => r.id !== summary.id)],
    });
  }

  async getRunSummary(runId: string): Promise<ResearchRunSummary | undefined> {
    const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
    return runs.runs.find((r) => r.id === runId);
  }

  async listRunSummaries(): Promise<ResearchRunSummary[]> {
    const runs = await this.store.read<RunsFile>(RUNS_FILE, { runs: [] });
    return runs.runs;
  }
}
