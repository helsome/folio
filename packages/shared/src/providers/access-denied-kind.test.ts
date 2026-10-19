/**
 * `ACCESS_DENIED` is the code the Massive adapter emits for HTTP 403
 * ("Your plan does not include access to this data"), so it belongs in the
 * `auth` class — the same class as `FORBIDDEN` — instead of falling through
 * to `'unknown'`.
 *
 * The kind is not internal bookkeeping: `capabilities/define.ts` interpolates
 * it into the failover-lineage sentence a user/agent reads, so `'unknown'`
 * surfaced as the self-contradictory `(ACCESS_DENIED; unknown)`.
 *
 * Deliberately a separate file: `resilience.test.ts` is currently being
 * edited by other open PRs, and this file overlaps none of them.
 */
import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import type { CapabilityResult } from '@finagent/core';
import { classifyFailure, isRetryableKind } from './resilience.ts';
import { defineCapability } from '../capabilities/define.ts';

describe('classifyFailure — the HTTP 403 codes', () => {
  it('classifies the code the Massive adapter emits for 403 as auth', () => {
    expect(classifyFailure('ACCESS_DENIED')).toBe('auth');
  });

  it('classifies the sibling 403 code as auth', () => {
    expect(classifyFailure('PERMISSION_DENIED')).toBe('auth');
  });

  it('stays non-retryable, like every other auth failure', () => {
    expect(isRetryableKind(classifyFailure('ACCESS_DENIED'))).toBe(false);
  });
});

describe('failover lineage sentence', () => {
  it('names the auth class instead of "unknown"', async () => {
    // `ProviderRouter` builds the step this way: `kind` comes from
    // `classifyFailure(error.code)`.
    const step = {
      providerId: 'massive',
      code: 'ACCESS_DENIED',
      kind: classifyFailure('ACCESS_DENIED'),
      attempts: 1,
      at: 1_700_000_000_000,
    };

    const capability = defineCapability<Record<string, never>, { ok: true }>({
      id: 'market.quote',
      name: 'Quote',
      description: 'test double',
      category: 'market',
      riskLevel: 'read',
      auth: 'public',
      toolName: 'get_quote',
      inputSchema: Type.Object({}),
      async execute(_input, _ctx, reportProvider) {
        reportProvider?.({
          providerId: 'longbridge',
          providerName: 'Longbridge',
          fetchedAt: 1_700_000_000_001,
          stale: false,
          failoverTrail: [step],
        });
        const result: CapabilityResult<{ ok: true }> = {
          data: { ok: true },
          provenance: { provider: 'longbridge', fetchedAt: 1_700_000_000_001, stale: false },
        };
        return result;
      },
    });

    const result = await capability.execute({});
    expect(result.evidence?.lineage?.[0]?.description).toBe(
      'Provider routing skipped massive after 1 attempt (ACCESS_DENIED; auth).'
    );
  });
});
