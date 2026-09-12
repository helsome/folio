// Acceptance-only `longbridge` CLI shim (#30 evidence): replays captured
// fixtures from packages/longbridge-tools/src/testing/fixtures so the REAL
// capability manifests (quote/news parsing, sanitization, evidence envelopes)
// run end-to-end without the Longbridge CLI. Compiled to a single-file
// executable with `bun build --compile` and injected via PATH.
import newsFixture from '../../../packages/longbridge-tools/src/testing/fixtures/news.json';
import staticFixture from '../../../packages/longbridge-tools/src/testing/fixtures/static.json';
import marketStatusFixture from '../../../packages/longbridge-tools/src/testing/fixtures/market-status.json';

const args = process.argv.slice(2);
const command = args[0] ?? '--version';

function priceFor(symbol: string): number {
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) % 100_000;
  return +(50 + (seed % 20_000) / 100).toFixed(2);
}

function emit(value: unknown): never {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}

if (command === '--version' || command === 'version') {
  process.stdout.write('longbridge shim 1.0 (acceptance fixture replay)');
  process.exit(0);
}

const positional = args.slice(1).filter((arg, index) => args[index] !== '--period' && args[index] !== '--start' && args[index] !== '--end' && args[index] !== '--count' && !arg.startsWith('-') && args[index - 1]?.startsWith('--') !== true);

switch (command) {
  case 'quote': {
    const symbols = args.slice(1).filter((a) => !a.startsWith('-') && a !== 'json');
    emit(symbols.map((raw) => {
      const symbol = raw.toUpperCase();
      const lastPrice = priceFor(symbol);
      const prevClose = +(lastPrice * 0.991).toFixed(2);
      return {
        symbol,
        last_price: lastPrice,
        prev_close: prevClose,
        change: +(lastPrice - prevClose).toFixed(2),
        change_ratio: +((lastPrice - prevClose) / prevClose).toFixed(6),
        high: +(lastPrice * 1.012).toFixed(2),
        low: +(lastPrice * 0.988).toFixed(2),
        open: +(lastPrice * 0.996).toFixed(2),
        volume: 52_341_000,
        timestamp: Math.floor(Date.now() / 1000),
      };
    }));
  }
  case 'kline': {
    const symbol = (positional[0] ?? 'AAPL.US').toUpperCase();
    const bars = [];
    const now = Math.floor(Date.now() / 1000);
    let base = priceFor(symbol);
    for (let day = 29; day >= 0; day -= 1) {
      const close = +(base * (1 + 0.004 * Math.sin(day / 4))).toFixed(2);
      bars.push({
        symbol,
        timestamp: now - day * 86_400,
        open: +(close * 0.997).toFixed(2),
        high: +(close * 1.008).toFixed(2),
        low: +(close * 0.992).toFixed(2),
        close,
        volume: 40_000_000 + day * 111_111,
      });
      base = close;
    }
    emit(bars);
  }
  case 'news':
    emit(newsFixture);
  case 'static':
    emit(staticFixture);
  case 'market-status':
    emit(marketStatusFixture);
  case 'intraday':
    emit([]);
  default:
    emit([]);
}
