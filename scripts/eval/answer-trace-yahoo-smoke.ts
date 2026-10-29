/**
 * Opt-in live acceptance slice for #106:
 *   bun scripts/eval/answer-trace-yahoo-smoke.ts
 * Calls only Yahoo's public AAPL quote through the production router and
 * capability. No API keys, paid providers, broker accounts, model, or UI.
 * Yahoo is unofficial, delayed, personal-use only and may rate-limit.
 */
import assert from 'node:assert/strict';
import { createMarketQuoteCapability } from '../../packages/shared/src/capabilities/manifests/market-quote.ts';
import { createRouterFetchers } from '../../packages/shared/src/providers/router-fetchers.ts';
import { ProviderRouter } from '../../packages/shared/src/providers/router.ts';
import { YahooChartFinancialDataProvider } from '../../packages/shared/src/providers/yahoo/adapter.ts';
import { buildAnswerEvidenceTrace } from '../../packages/shared/src/evidence/answer-trace.ts';
import { buildFinancialEvidence } from '../../packages/shared/src/evidence/financial-evidence.ts';
import { parseEvidenceBundle, serializeEvidenceBundle } from '../../packages/shared/src/evidence/contract.ts';

const startedAt = Date.now();
const router = new ProviderRouter({ timeoutMs: 15_000 });
router.register(new YahooChartFinancialDataProvider());
router.setRouting({ primary: 'yahoo' });

try {
  const result = await createMarketQuoteCapability(createRouterFetchers(router)).execute(
    { symbol: 'AAPL.US' }, { signal: AbortSignal.timeout(20_000) },
  );
  assert.equal(result.provenance.providerId, 'yahoo');
  assert.equal(result.provenance.delayed, true);
  assert.equal(result.provenance.marketTime, result.data.timestamp * 1000);
  assert.equal(result.data.source?.providerId, 'yahoo');
  assert(Number.isFinite(result.data.lastPrice) && result.data.lastPrice > 0);
  const financialEvidence = buildFinancialEvidence({
    sessionId: 'yahoo-live-smoke', runId: 'quote-trace-smoke',
    toolCalls: [{
      id: 'quote-1', toolName: 'get_quote', args: { symbol: 'AAPL.US' },
      status: 'success', startedAt, completedAt: Date.now(), result,
    }],
  });
  const envelope = financialEvidence[0]!;
  assert.equal(envelope.provider, 'yahoo');
  assert.equal(envelope.delayed, true);
  assert.equal(envelope.asOf, result.provenance.marketTime);
  const trace = buildAnswerEvidenceTrace({
    sessionId: 'yahoo-live-smoke', runId: 'quote-trace-smoke',
    question: 'What is the delayed AAPL quote?', financialEvidence,
    answer: ['~~~folio-block', JSON.stringify({
      version: 1, type: 'metric_grid',
      metrics: [{ label: 'Last price', value: result.data.lastPrice, unit: 'price', currency: 'USD' }],
      evidenceIds: [envelope.id],
    }), '~~~'].join('\n'),
  });
  const citation = trace.citations[0]!;
  assert.equal(trace.bundle.sources[0]!.publisher, 'yahoo');
  assert.deepEqual(citation.unmappedEvidenceIds, []);
  assert(citation.mappedEvidenceIds.length > 0);
  for (const item of trace.bundle.evidence) {
    assert.equal(item.provenance.provider, 'yahoo');
    assert.equal(item.provenance.envelopeId, envelope.id);
    assert.equal(item.freshness.delayed, true);
    assert.equal(item.freshness.retrievedAt, result.provenance.fetchedAt);
    assert(citation.mappedEvidenceIds.includes(item.evidenceId));
  }
  const price = trace.bundle.evidence.find((item) => item.financial?.metric === 'lastPrice')!;
  assert.equal(price.financial?.value, result.data.lastPrice);
  assert.equal(price.freshness.asOf, result.provenance.marketTime);
  assert.deepEqual(parseEvidenceBundle(serializeEvidenceBundle(trace.bundle)), trace.bundle);
  console.log(JSON.stringify({
    scope: 'live public quote -> capability -> financial evidence -> answer trace; no model or UI',
    ok: true, symbol: result.data.symbol, lastPrice: result.data.lastPrice,
    provider: result.provenance.providerId, providerName: result.provenance.providerName,
    delayed: price.freshness.delayed, stale: price.freshness.stale,
    retrievedAt: result.provenance.fetchedAt, marketTime: result.provenance.marketTime,
    retrievedAtIso: new Date(result.provenance.fetchedAt).toISOString(),
    marketTimeIso: new Date(result.provenance.marketTime!).toISOString(),
    envelopeId: envelope.id, priceEvidenceId: price.evidenceId,
    citation, bundleReloadVerified: true,
  }, null, 2));
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'SMOKE_FAILED';
  console.error(JSON.stringify({
    scope: 'live public Yahoo quote to answer trace; no model or UI', ok: false, code,
    message: error instanceof Error ? error.message : 'Live quote validation failed',
  }, null, 2));
  process.exitCode = 1;
}
