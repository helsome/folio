/**
 * Secret redaction for diagnostics exports (spec §36).
 *
 * NOTE: As of issue #19, this is a thin re-export of the centralized
 * redaction module. All new code should import from '@finagent/shared/redaction'
 * directly. This file remains for backward compatibility.
 */

import { REDACTION_POLICY_DOC, REDACTED } from '../../redaction/index.ts';

export { redactString as redact, REDACTED };
/** @deprecated Use REDACTION_POLICY_DOC instead. */
export const REDACTION_POLICY = REDACTION_POLICY_DOC;
