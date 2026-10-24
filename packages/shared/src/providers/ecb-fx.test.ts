import { describe, expect, it } from 'bun:test';
import { fetchEcbConversion } from './ecb-fx.ts';

const CSV = [
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,TITLE',
  'EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2025-06-27,0.8529,"GBP rate"',
  'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-06-27,1.1704,"USD rate"',
  'EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2025-06-30,0.8550,"GBP rate"',
].join('\n');

describe('ECB dated currency conversion', () => {
  it('uses a common fixing date and records the exact ECB series URL', async () => {
    let requested = '';
    const request = (async (url: string) => {
      requested = url;
      return new Response(CSV, { status: 200 });
    });
    const rate = await fetchEcbConversion('GBP', 'USD', Date.parse('2025-06-30T00:00:00Z'), request);
    expect(rate?.factor).toBeCloseTo(1.1704 / 0.8529);
    expect(rate?.asOf).toBe(Date.parse('2025-06-27T00:00:00Z'));
    expect(rate?.source).toContain('2025-06-27');
    expect(requested).toContain('D.GBP+USD.EUR.SP00.A');
  });

  it('leaves missing rates incomparable', async () => {
    const request = async () => new Response('KEY,CURRENCY,TIME_PERIOD,OBS_VALUE\n', { status: 200 });
    expect(await fetchEcbConversion('EUR', 'USD', Date.now(), request)).toBeUndefined();
  });
});
