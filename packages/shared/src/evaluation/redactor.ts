// Unified trace redaction + privacy levels (spec §56-60).
//
// NOTE: As of issue #19, this is a thin re-export of the centralized
// redaction module. All new code should import from '@finagent/shared/redaction'
// directly. This file remains for backward compatibility.

export {
  Redactor as EvaluationRedactor,
  type RedactionResult,
  type PrivacyLevel,
  isPortfolioToolName,
} from '../../redaction/index.ts';
