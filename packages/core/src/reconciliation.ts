/** Deterministic, provider-neutral reconciliation of financial facts. */
export type ReconciliationState = 'agreement'|'within-tolerance'|'material-conflict'|'incomparable'|'insufficient-sources';
export interface FinancialFactCandidate { provider:string; instrument?:string; value:number; asOf?:number; period?:string; currency?:string; unit?:string; adjustment?:string; }
export interface ReconciliationPolicy { version:string; absoluteTolerance?:number; relativeTolerance?:number; providerPriority?:string[]; }
export interface ReconciliationResult { state:ReconciliationState; candidates:FinancialFactCandidate[]; selected?:FinancialFactCandidate; discrepancy?:number; reason:string; policyVersion:string; sourceCount?:number; selectedReason?:string; }
export function reconcileFinancialFacts(candidates:FinancialFactCandidate[], policy:ReconciliationPolicy):ReconciliationResult {
 const base={candidates:[...candidates],policyVersion:policy.version};
 if(candidates.length<2)return {...base,state:'insufficient-sources',sourceCount:candidates.length,reason:'At least two provider candidates are required.'};
 const first=candidates[0];
 const comparable=candidates.every(c=>c.period===first.period&&c.currency===first.currency&&c.unit===first.unit&&c.adjustment===first.adjustment);
 if(!comparable)return {...base,state:'incomparable',sourceCount:candidates.length,reason:'Candidates use different period, currency, unit, or adjustment semantics.'};
 const values=candidates.map(c=>c.value), min=Math.min(...values), max=Math.max(...values), discrepancy=max-min, scale=Math.max(...values.map(v=>Math.abs(v)),1);
 const within=(policy.absoluteTolerance!=null&&discrepancy<=policy.absoluteTolerance)||(policy.relativeTolerance!=null&&discrepancy/scale<=policy.relativeTolerance);
 const prioritySelected=(policy.providerPriority??[]).map(p=>candidates.find(c=>c.provider===p)).find(Boolean);
 const selected=prioritySelected??first;
 const state=discrepancy===0?'agreement':within?'within-tolerance':'material-conflict';
 const selectedReason=prioritySelected
  ? `Selected provider "${selected.provider}" per policy priority.`
  : 'No provider priority configured; first candidate retained.';
 return {...base,state,sourceCount:candidates.length,discrepancy,selected,selectedReason,reason:state==='agreement'?'Candidates agree exactly.':state==='within-tolerance'?'Difference is within policy tolerance.':'Material disagreement; candidates are preserved and never averaged.'};
}
