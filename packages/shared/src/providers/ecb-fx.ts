import type { ReconciliationConversion } from '@finagent/core';

const ECB_EXR_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/';
const DAY_MS = 86_400_000;
type FxRequest = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Return a dated ECB reference-rate conversion, or leave the values
 * incomparable. ECB series are quoted as units of currency per one EUR.
 */
export async function fetchEcbConversion(
  from: string,
  to: string,
  asOf: number,
  request: FxRequest = fetch
): Promise<ReconciliationConversion | undefined> {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)
    || from === to || !Number.isFinite(asOf)) return undefined;
  const currencies = [...new Set([from, to].filter((currency) => currency !== 'EUR'))].sort();
  const end = new Date(asOf).toISOString().slice(0, 10);
  const start = new Date(asOf - 7 * DAY_MS).toISOString().slice(0, 10);
  const url = new URL(`D.${currencies.join('+')}.EUR.SP00.A`, ECB_EXR_URL);
  url.searchParams.set('startPeriod', start);
  url.searchParams.set('endPeriod', end);
  url.searchParams.set('format', 'csvdata');

  try {
    const response = await request(url.toString(), {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
    const header = lines.shift()?.split(',') ?? [];
    const currencyIndex = header.indexOf('CURRENCY');
    const dateIndex = header.indexOf('TIME_PERIOD');
    const valueIndex = header.indexOf('OBS_VALUE');
    if (currencyIndex < 0 || dateIndex < 0 || valueIndex < 0) return undefined;

    const rates = new Map<string, Map<string, number>>();
    for (const line of lines) {
      // The columns we read precede the quoted description fields in ECB CSV.
      const columns = line.split(',', Math.max(currencyIndex, dateIndex, valueIndex) + 2);
      const currency = columns[currencyIndex];
      const date = columns[dateIndex];
      const rate = Number(columns[valueIndex]);
      if (!currencies.includes(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || date > end || !Number.isFinite(rate) || rate <= 0) continue;
      const byCurrency = rates.get(date) ?? new Map<string, number>();
      byCurrency.set(currency, rate);
      rates.set(date, byCurrency);
    }

    const date = [...rates.keys()].sort().reverse().find((candidate) =>
      currencies.every((currency) => rates.get(candidate)?.has(currency))
    );
    if (!date) return undefined;
    const fixing = rates.get(date)!;
    const fromRate = from === 'EUR' ? 1 : fixing.get(from)!;
    const toRate = to === 'EUR' ? 1 : fixing.get(to)!;
    const factor = toRate / fromRate;
    if (!Number.isFinite(factor) || factor <= 0) return undefined;
    return {
      from, to, factor,
      source: `ECB EXR daily reference rates (${date}; ${currencies.join(',')}/EUR): ${url.toString()}`,
      asOf: Date.parse(`${date}T00:00:00Z`),
    };
  } catch {
    // A missing rate or network failure must never authorize a comparison.
    return undefined;
  }
}
