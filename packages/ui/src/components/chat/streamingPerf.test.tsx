import { describe, expect, it } from 'bun:test';
import { splitStableTail } from './StreamingMarkdown';

function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function buildDocument(blocks: number): string {
  const parts: string[] = [];
  for (let index = 0; index < blocks; index += 1) {
    parts.push(
      `## Section ${index}`,
      '',
      `Paragraph ${index} with **bold** and a [link](https://example.com/${index}).`,
      '',
    );
  }
  return parts.join('\n');
}

/**
 * The naive streaming renderer parses the *entire* document on every delta, so
 * the characters it feeds to remark grow like O(n^2). With a frozen prefix only
 * the still-growing tail is re-parsed, so the work grows like O(n). These tests
 * assert that relationship directly — deterministic, no wall-clock thresholds.
 */
describe('StreamingMarkdown — incremental cost is linear, not quadratic', () => {
  it('re-parses only the growing tail, not the whole document', () => {
    const full = buildDocument(300);
    const tokens = tokenize(full);

    let accumulated = '';
    let naiveParsedChars = 0;
    let incrementalParsedChars = 0;

    for (const token of tokens) {
      accumulated += token;
      naiveParsedChars += accumulated.length; // whole-document re-parse per delta
      incrementalParsedChars += splitStableTail(accumulated).tail.length; // frozen prefix skipped
    }

    expect(naiveParsedChars).toBeGreaterThan(0);
    expect(incrementalParsedChars).toBeGreaterThan(0);
    // Linear incremental work must be orders of magnitude below the quadratic
    // baseline; a factor of 20 is a deliberately loose, machine-independent bar.
    expect(incrementalParsedChars).toBeLessThan(naiveParsedChars / 20);
  });

  it('keeps the frozen prefix monotonic so memoization always holds', () => {
    const full = buildDocument(60);
    let accumulated = '';
    let previousStable = '';

    for (const token of tokenize(full)) {
      accumulated += token;
      const { stable } = splitStableTail(accumulated);
      expect(accumulated.startsWith(stable)).toBe(true);
      expect(stable.length).toBeGreaterThanOrEqual(previousStable.length);
      expect(stable.startsWith(previousStable)).toBe(true);
      previousStable = stable;
    }
  });
});
