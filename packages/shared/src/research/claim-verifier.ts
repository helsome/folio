import type { JudgeClient } from '../evaluation/judge-client.ts';

export const CLAIM_VERIFIER_VERSION = 'claim-verifier-v1';

export type ClaimVerificationStatus =
  | 'supported'
  | 'contradicted'
  | 'insufficient_evidence';

export interface ClaimVerifierEvidence {
  id: string;
  content: string;
}

/** Standalone Phase 1 input; integration adapters may map domain claims to it later. */
export interface ClaimVerificationInput {
  claimId: string;
  claimText: string;
  evidence: ClaimVerifierEvidence[];
}

export interface ClaimVerificationResult {
  claimId: string;
  status: ClaimVerificationStatus;
  evidenceIds: string[];
  /** Explanation only. This value is never treated as source evidence. */
  reason: string;
  verifierVersion: typeof CLAIM_VERIFIER_VERSION;
}

export interface ClaimVerifier {
  verify(input: ClaimVerificationInput, signal?: AbortSignal): Promise<ClaimVerificationResult>;
}

interface JudgeResult {
  status: ClaimVerificationStatus;
  reason: string;
}

const STATUSES = new Set<ClaimVerificationStatus>([
  'supported',
  'contradicted',
  'insufficient_evidence',
]);

const SYSTEM_PROMPT = `You verify one claim against ONLY the supplied source evidence.
Do not use background knowledge, assumptions, or facts absent from the supplied evidence.
A plausible explanation is not evidence. A causal or root-cause claim requires evidence that establishes the causal link.
Return supported only when the supplied evidence directly supports the entire claim.
Return contradicted when the supplied evidence directly conflicts with the claim.
Otherwise return insufficient_evidence.
Reply with ONLY strict JSON in this exact shape:
{"status":"supported|contradicted|insufficient_evidence","reason":"brief explanation"}`;

function userPrompt(input: ClaimVerificationInput): string {
  const evidence = input.evidence
    .map((item) => `[evidence id=${JSON.stringify(item.id)}]\n${item.content}`)
    .join('\n\n');
  return [
    'CLAIM',
    input.claimText,
    '',
    'SUPPLIED SOURCE EVIDENCE',
    evidence,
  ].join('\n');
}

function parseJudgeResult(reply: string): JudgeResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(reply.trim());
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.status !== 'string' || !STATUSES.has(record.status as ClaimVerificationStatus)) {
    return undefined;
  }
  if (typeof record.reason !== 'string' || record.reason.trim() === '') return undefined;
  return {
    status: record.status as ClaimVerificationStatus,
    reason: record.reason.trim(),
  };
}

function result(
  input: ClaimVerificationInput,
  status: ClaimVerificationStatus,
  reason: string,
): ClaimVerificationResult {
  return {
    claimId: input.claimId,
    status,
    evidenceIds: input.evidence.map((item) => item.id),
    reason,
    verifierVersion: CLAIM_VERIFIER_VERSION,
  };
}

export function createClaimVerifier(client: JudgeClient): ClaimVerifier {
  return {
    async verify(input, signal) {
      if (input.evidence.length === 0) {
        return result(
          input,
          'insufficient_evidence',
          'No source evidence was provided for this claim.',
        );
      }

      try {
        const reply = await client.complete(SYSTEM_PROMPT, userPrompt(input), signal);
        const parsed = parseJudgeResult(reply);
        if (parsed === undefined) {
          return result(
            input,
            'insufficient_evidence',
            'judge_error: malformed reply; expected strict JSON with a known status and non-empty reason',
          );
        }
        return result(input, parsed.status, parsed.reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(input, 'insufficient_evidence', `judge_error: ${message}`);
      }
    },
  };
}
