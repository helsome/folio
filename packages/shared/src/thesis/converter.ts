import { z } from 'zod';
import type { EvidenceRef, ResearchReport } from '@finagent/core';
import type { InvestmentThesis, ThesisStance } from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';

const evidenceRefSchema = z.object({
  capabilityId: z.string(),
  runId: z.string(),
  claim: z.string(),
  fetchedAt: z.number(),
  summary: z.string().optional(),
});

/** Strict InvestmentThesis shape for parsing agent-produced drafts. */
export const thesisSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  stance: z.enum(['bullish', 'bearish', 'neutral']),
  summary: z.string(),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  catalysts: z.array(z.string()),
  risks: z.array(z.string()),
  targetPrice: z.number().optional(),
  evidenceRefs: z.array(evidenceRefSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastReviewedAt: z.number(),
});

/**
 * Map a completed ResearchReport into an editable InvestmentThesis. Pure:
 * stance/summary/bull/bear/catalysts/risks come straight off the report and the
 * evidence links are the union of every section's evidence refs.
 */
export function reportToThesis(
  report: ResearchReport,
  idGen: () => string,
  now: () => number = Date.now
): InvestmentThesis {
  const evidenceRefs: EvidenceRef[] = report.sections.flatMap((section) => section.evidence);
  const timestamp = now();
  return {
    id: idGen(),
    symbol: report.symbol,
    stance: report.stance as ThesisStance,
    summary: report.summary,
    bullCase: [...report.bullCase],
    bearCase: [...report.bearCase],
    catalysts: [...report.catalysts],
    risks: [...report.risks],
    evidenceRefs,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastReviewedAt: timestamp,
  };
}

/**
 * Extract a JSON object from either ```json fences, bare JSON, or prose that
 * embeds a single balanced `{...}` span. Throws `THESIS_PARSE_ERROR` when
 * nothing parses.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through to the shared error */
      }
    }
    throw parseError('Could not parse JSON from the response.');
  }
}

/** Strictly validate an unknown value as an `InvestmentThesis`. */
export function validateThesis(value: unknown): InvestmentThesis {
  const parsed = thesisSchema.safeParse(value);
  if (!parsed.success) {
    throw parseError(summarizeZodError(parsed.error));
  }
  return parsed.data as InvestmentThesis;
}

/** Parse an agent-produced thesis draft (fenced or raw JSON), strictly validated. */
export function parseThesisDraftJson(text: string): InvestmentThesis {
  return validateThesis(extractJsonObject(text));
}

function parseError(detail: string): Error & { code: string } {
  return createCodeError('THESIS_PARSE_ERROR', `Invalid thesis JSON: ${detail}`);
}

function summarizeZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'shape mismatch';
  return `${first.path.join('.') || '(root)'}: ${first.message}`;
}
