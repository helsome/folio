#!/usr/bin/env bun
/**
 * i18n-audit — high-signal hardcoded user-facing string scanner (spec §85–86).
 *
 * Assistive, not authoritative: flags candidate USER-FACING string literals in
 * UI files so a human can review. Legit by design and NOT flagged:
 *   - domain identifiers (tickers, ids, tool names, currency codes, URLs)
 *   - test-ids, class names, aria plumbing, data field keys
 *   - API/implementation strings (no letters or pure lowercase snake/camel)
 *   - historical-content rendering (stored user/AI text must NOT be translated)
 *
 * Run:  bun scripts/i18n-audit.ts [--json]
 * Exit: 0 always (informational; see coverage report).
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SCOPES = ['packages/ui/src/components', 'packages/ui/src/lib'];
const EXTS = new Set(['.tsx', '.ts']);

// JSX text/attribute contexts likely user-facing.
const RESUMED_PATTERNS: Array<[RegExp, string]> = [
  [/>\s*["'`]?([A-Z][a-zA-Z]+(?: [A-Za-z0-9$%&'\-–—/.,()]+){0,6})["'`]?\s*<\//g, 'jsx-text'],
  [/\b(placeholder|title|aria-label|description|label|message|hint|prompt|subtitle|summary)=\{?"?`?(["']?)([A-Z][a-zA-Z]+(?: [A-Za-z0-9$%&'\-–—/.,()]{1,}){0,5})(?:["'`]?)\}/g, 'attr'],
  [/\btoast\.(?:success|error|info|warning)\(\s*["'`]([A-Z][^"'`]{4,80})/g, 'toast'],
];

const IDENTIFIER_RE =
  /\b(AAPL|GOOGL|NVDA|MSFT|TSLA|AMD|META|AMZN|QQQ|SPY|USD|HKD|CNY|SGD|Longbridge|Folio|LangSmith|Pi|Agent|LLM|DeepSeek|Anthropic|OpenAI|Radix|Sonner)\b/;
const DOTTED_KEY_RE = /^[a-z][a-zA-Z0-9]+\.[a-zA-Z0-9.]+(\.[a-zA-Z0-9]+)$/;
const COLORISH_RE = /^(text|bg|border|className|data-|id=)/;

interface Hit {
  file: string;
  line: number;
  kind: string;
  text: string;
  suspicious: boolean;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

const files = SCOPES.flatMap((s) => walk(join(ROOT, s)));
const hits: Hit[] = [];
let reviewed = 0;

for (const file of files) {
  const content = require('node:fs').readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [re, kind] of RESUMED_PATTERNS) {
      for (const m of line.matchAll(re)) {
        const text = (m[1] ?? m[3] ?? '').trim();
        if (!text || text.length < 3) continue;
        if (text.length > 80) continue;
        if (DOTTED_KEY_RE.test(text)) continue;
        if (COLORISH_RE.test(text)) continue;
        if (IDENTIFIER_RE.test(text) && kind === 'attr' && text.length < 24) continue;
        // Ticker-like / all-caps codes, numbers, or pure snake_case data keys.
        if (/^[A-Z]{2,6}[A-Z0-9.-]*$/.test(text)) continue;
        if (/^[a-z_]+$/.test(text)) continue;
        if (/^\d/.test(text)) continue;
        // common valid single verbs / labels
        if (/^(Save|Cancel|Close|Search|Retry|Apply|Refresh|Done|Back|Remove|Edit|Copy|Add|Open)$/.test(text)) continue;
        reviewed += 1;
        hits.push({ file: relative(ROOT, file), line: i + 1, kind, text, suspicious: /[a-z]{2,}/.test(text) });
      }
    }
  }
}

const suspicious = hits.filter((h) => h.suspicious);
console.log(`i18n-audit: scanned ${files.length} files, ${reviewed} candidate literals (${suspicious.length} suspicious)`);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: hits.length, suspicious: suspicious.length, hits: hits.slice(0, 200) }, null, 2));
  process.exit(0);
}
const byFile = new Map<string, number>();
for (const h of suspicious) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('\nTop files by suspicious candidate strings:');
for (const [f, n] of top) console.log(`  ${n.toString().padStart(3)}  ${f}`);
console.log('\nWorst 25 candidates (review these):');
for (const h of suspicious.slice(0, 25)) {
  console.log(`  ${h.file}:${h.line} [${h.kind}] ${JSON.stringify(h.text).slice(0, 70)}`);
}
