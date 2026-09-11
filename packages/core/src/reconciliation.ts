/** Provider-neutral reconciliation for comparable financial facts. */
export type ReconciliationState = 'agreement'|'within-tolerance'|'material-conflict'|'incomparable'|'insufficient-sources';
export interface FinancialFactCandidate { provider: string; value: number; asOf?: number; period?: string; currency?: string; unit?: string; adjustment?: string; }
export interface ReconciliationPolicy { version: string; absoluteTolerance?: number; relativeTolerance?: number; providerPriority?: string[]; }
export interface ReconciliationResult { state: ReconciliationState; candidates: FinancialFactCandidate[]; selected?: FinancialFactCandidate; discrepancy?: number; reason: string; policyVersion: string; }
export function reconcileFinancialFacts(candidates: FinancialFactCandidate[], policy: ReconciliationPolicy): ReconciliationResult {
  const base={candidates,policyVersion:policy.version};
  if(candidates.length<2) return {...base,state:'insufficient-sources',reason:'At least two provider candidates are required.'};
  const first=candidates[0];
  const comparable=candidates.every(c=>c.currency===first.currency&&c.unit===first.unit&&c.adjustment===first.adjustment&&c.period===first.period);
  if(!comparable) return {...base,state:'incomparable',reason:'Candidates use different period, currency, unit, or adjustment semantics.'};
  const min=Math.min(...candidates.map(c=>c.value)), max=Math.max(...candidates.map(c=>c.value));
  const discrepancy=max-min, scale=Math.max(Math.abs(first.value),1);
  const within=(policy.absoluteTolerance!=null&&discrepancy<=policy.absoluteTolerance)||(policy.relativeTolerance!=null&&discrepancy/scale<=policy.relativeTolerance);
  const selected=(policy.providerPriority??[]).map(p=>candidates.find(c=>c.provider===p)).find(Boolean)??first;
  return {...base,state:discrepancy===0?'agreement':within?'within-tolerance':'material-conflict',discrepancy,selected,reason:discrepancy===0?'Candidates agree exactly.':within?'Difference is within policy tolerance.':'Material disagreement; no silent averaging or overwrite.'};
}
