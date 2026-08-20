/**
 * Compatibility shim for the V9 capability label API.
 *
 * V9.1 consolidated all agent-execution labels into ONE shared module
 * (`lib/agentPresentation.ts`); this file re-exports the same functions so
 * existing callers keep working without drifting into a second dictionary.
 * Prefer importing from `agentPresentation` directly in new code.
 */
export { semanticCapabilityLabelKey as capabilityLabelKey, hasSemanticToolLabel as hasCapabilityLabel } from './agentPresentation';
