import type { EvidenceRef, ResearchClaim, ResearchReport } from '@finagent/core';

/**
 * Claim ↔ evidence identity for Deep Research reports (issue #13, step 1).
 *
 * The report itself stays the single source of truth: every id here is derived
 * deterministically from data the report already carries (section key, run id,
 * capability id, position), so rebuilding the mapping after a reload yields
 * exactly the links that were written at assembly time — no side table to keep
 * in sync, no clock, no filesystem.
 *
 * The relation is deliberately many-to-many: a claim may need several pieces of
 * evidence, and one piece of evidence may back several claims.
 */

/** Stable evidence id, derived from the producing run rather than array order. */
export function evidenceIdOf(runId: string, capabilityId: string): string {
  return `evidence:${runId}:${capabilityId}`;
}

/** Stable claim id for the n-th claim of a section. */
export function claimIdOf(sectionKey: string, index = 0): string {
  return `claim:${sectionKey}:${index}`;
}

/**
 * Both directions of the claim ↔ evidence relation, as plain records so they
 * survive JSON persistence and stay deterministic across reloads.
 */
export interface ClaimEvidenceIndex {
  /** claim id → ids of the evidence backing it. Empty array = nothing backs it. */
  claimToEvidence: Record<string, string[]>;
  /** evidence id → ids of the claims that reference it. */
  evidenceToClaims: Record<string, string[]>;
}

/**
 * Claims of a report, including reports written before `claims[]` existed.
 * Those fall back to one claim per evidence ref, keyed by section + position —
 * the same ids the current assembler would have written for them.
 */
export function collectReportClaims(report: ResearchReport): ResearchClaim[] {
  if (report.claims && report.claims.length > 0) return report.claims;

  const claims: ResearchClaim[] = [];
  for (const section of report.sections) {
    section.evidence.forEach((ref, index) => {
      claims.push({
        id: ref.claimId ?? claimIdOf(section.key, index),
        sectionKey: section.key,
        text: ref.claim,
        evidenceRefs: [evidenceIdOf(ref.runId, ref.capabilityId)],
      });
    });
  }
  return claims;
}

/**
 * Rebuilds the bidirectional claim ↔ evidence mapping from a report.
 *
 * Declared claims are registered first so that a claim nothing backs stays
 * visible as an empty edge instead of disappearing; section evidence is then
 * folded in, which is also the only source for legacy reports.
 */
export function buildClaimEvidenceIndex(report: ResearchReport): ClaimEvidenceIndex {
  const claimToEvidence: Record<string, string[]> = {};
  const evidenceToClaims: Record<string, string[]> = {};

  const link = (claimId: string, evidenceId: string) => {
    const forward = claimToEvidence[claimId] ?? (claimToEvidence[claimId] = []);
    if (!forward.includes(evidenceId)) forward.push(evidenceId);

    const backward = evidenceToClaims[evidenceId] ?? (evidenceToClaims[evidenceId] = []);
    if (!backward.includes(claimId)) backward.push(claimId);
  };

  for (const claim of report.claims ?? []) {
    if (!claimToEvidence[claim.id]) claimToEvidence[claim.id] = [];
    for (const evidenceId of claim.evidenceRefs) link(claim.id, evidenceId);
  }

  for (const section of report.sections) {
    section.evidence.forEach((ref, index) => {
      const evidenceId = ref.id ?? evidenceIdOf(ref.runId, ref.capabilityId);
      const claimId = ref.claimId ?? claimIdOf(section.key, index);
      link(claimId, evidenceId);
    });
  }

  return { claimToEvidence, evidenceToClaims };
}

/** Evidence refs backing a claim, in report order. */
export function evidenceForClaim(report: ResearchReport, claimId: string): EvidenceRef[] {
  const wanted = new Set(buildClaimEvidenceIndex(report).claimToEvidence[claimId] ?? []);
  if (wanted.size === 0) return [];

  const refs: EvidenceRef[] = [];
  for (const section of report.sections) {
    for (const ref of section.evidence) {
      const evidenceId = ref.id ?? evidenceIdOf(ref.runId, ref.capabilityId);
      if (wanted.has(evidenceId)) refs.push(ref);
    }
  }
  return refs;
}

/** Claims that reference a piece of evidence — the reverse lookup. */
export function claimsForEvidence(report: ResearchReport, evidenceId: string): ResearchClaim[] {
  const ids = buildClaimEvidenceIndex(report).evidenceToClaims[evidenceId] ?? [];
  if (ids.length === 0) return [];

  const byId = new Map(collectReportClaims(report).map((claim) => [claim.id, claim]));
  return ids
    .map((id) => byId.get(id))
    .filter((claim): claim is ResearchClaim => claim !== undefined);
}

/**
 * Claims with no evidence behind them. These are the ones that must not be
 * presented as verified conclusions without an explicit marker.
 */
export function findUnbackedClaims(report: ResearchReport): ResearchClaim[] {
  const { claimToEvidence } = buildClaimEvidenceIndex(report);
  return collectReportClaims(report).filter(
    (claim) => (claimToEvidence[claim.id] ?? []).length === 0
  );
}
