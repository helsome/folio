import type { ResearchSynthesis, ResearchSynthesisInput, ResearchSynthesizer } from '@finagent/core';
import { createCodeError } from '../agent/errors.ts';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';

/**
 * Agent-backed synthesizer boundary. The runner is injected by the Lead at
 * integration (it drives the agent kernel in a research session); here we
 * only define the contract, the JSON parser, and the honest fallback.
 */

export type ResearchAgentRunner = (
  input: ResearchSynthesisInput,
  signal?: AbortSignal
) => Promise<ResearchSynthesis>;

const STANCE_VALUES = new Set(['bullish', 'bearish', 'neutral']);
const VERDICT_VALUES = new Set(['positive', 'negative', 'neutral', 'unavailable']);

/**
 * Parse an agent's textual synthesis output into a strictly-validated
 * `ResearchSynthesis`. Accepts raw JSON or a fenced ` ```json ` block.
 * Throws `SYNTHESIS_PARSE_ERROR` on any shape violation.
 */
export function parseSynthesisJson(text: string): ResearchSynthesis {
  const candidate = extractJson(text);
  if (!candidate || typeof candidate !== 'object') {
    throw createCodeError(
      'SYNTHESIS_PARSE_ERROR',
      'Synthesis output did not contain a JSON object.'
    );
  }
  const value = candidate as Record<string, unknown>;

  if (typeof value.summary !== 'string' || value.summary.length === 0) {
    throw createCodeError('SYNTHESIS_PARSE_ERROR', 'Missing "summary" string.');
  }
  if (typeof value.stance !== 'string' || !STANCE_VALUES.has(value.stance)) {
    throw createCodeError('SYNTHESIS_PARSE_ERROR', 'Invalid or missing "stance".');
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
    throw createCodeError('SYNTHESIS_PARSE_ERROR', 'Missing numeric "confidence".');
  }
  const confidence = Math.min(1, Math.max(0, value.confidence));

  if (!Array.isArray(value.sections)) {
    throw createCodeError('SYNTHESIS_PARSE_ERROR', 'Missing "sections" array.');
  }
  const sections = value.sections.map((section, index) => {
    if (!section || typeof section !== 'object') {
      throw createCodeError('SYNTHESIS_PARSE_ERROR', `sections[${index}] is not an object.`);
    }
    const entry = section as Record<string, unknown>;
    if (typeof entry.key !== 'string' || typeof entry.title !== 'string') {
      throw createCodeError('SYNTHESIS_PARSE_ERROR', `sections[${index}] missing key/title.`);
    }
    if (typeof entry.verdict !== 'string' || !VERDICT_VALUES.has(entry.verdict)) {
      throw createCodeError('SYNTHESIS_PARSE_ERROR', `sections[${index}] has invalid verdict.`);
    }
    if (typeof entry.summary !== 'string') {
      throw createCodeError('SYNTHESIS_PARSE_ERROR', `sections[${index}] missing summary.`);
    }
    return {
      key: entry.key,
      title: entry.title,
      verdict: entry.verdict as ResearchSynthesis['sections'][number]['verdict'],
      summary: entry.summary,
    };
  });

  return {
    summary: value.summary,
    stance: value.stance as ResearchSynthesis['stance'],
    confidence,
    sections,
    bullCase: stringArray(value.bullCase, 'bullCase'),
    bearCase: stringArray(value.bearCase, 'bearCase'),
    catalysts: stringArray(value.catalysts, 'catalysts'),
    risks: stringArray(value.risks, 'risks'),
  };
}

/**
 * Wrap an agent runner as a `ResearchSynthesizer` with a deterministic local
 * fallback: any failure (agent unavailable, malformed output, parse error)
 * degrades to the honest local synthesizer — never fabricated prose.
 */
export function createAgentSynthesizer(run: ResearchAgentRunner): ResearchSynthesizer {
  const fallback = new LocalResearchSynthesizer();
  return {
    async synthesize(input, signal) {
      try {
        return await run(input, signal);
      } catch {
        return fallback.synthesize(input, signal);
      }
    },
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return tryParse(fenced[1]);
  }

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // Last resort: find the first balanced-looking {...} span.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw createCodeError('SYNTHESIS_PARSE_ERROR', `Missing or invalid "${field}" string array.`);
  }
  return value as string[];
}
