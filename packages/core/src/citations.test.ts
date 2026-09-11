import { describe, expect, it } from 'bun:test';
import {
  CITATION_MARKER_END,
  CITATION_MARKER_START,
  buildCitationNumbering,
  isCitationSourceId,
  parseCitationSegments,
  renderCitationMarker,
} from './citations.ts';

describe('citations contract', () => {
  describe('isCitationSourceId', () => {
    it('accepts tool-call and envelope-style ids', () => {
      expect(isCitationSourceId('get_quote-1737012345678')).toBe(true);
      expect(isCitationSourceId('fe_a1b2c3d4e5f6a1b2c3d4e5f6')).toBe(true);
      expect(isCitationSourceId('tc_123:456')).toBe(true);
    });

    it('rejects malformed ids', () => {
      expect(isCitationSourceId('')).toBe(false);
      expect(isCitationSourceId('has space')).toBe(false);
      expect(isCitationSourceId('nonsense id ⟧')).toBe(false);
      expect(isCitationSourceId(`${'a'.repeat(81)}`)).toBe(false);
      expect(isCitationSourceId(42)).toBe(false);
    });
  });

  describe('parseCitationSegments', () => {
    it('splits text and citation markers', () => {
      const segments = parseCitationSegments(
        `AAPL last traded at 182.31 USD.${renderCitationMarker('get_quote-1')} Next sentence.`
      );
      expect(segments).toEqual([
        { kind: 'text', text: 'AAPL last traded at 182.31 USD.' },
        { kind: 'citation', sourceId: 'get_quote-1', raw: `${CITATION_MARKER_START}get_quote-1${CITATION_MARKER_END}` },
        { kind: 'text', text: ' Next sentence.' },
      ]);
    });

    it('handles multiple markers and adjacent markers', () => {
      const segments = parseCitationSegments(
        `${renderCitationMarker('a-1')}${renderCitationMarker('b-2')} tail`
      );
      expect(segments.filter((segment) => segment.kind === 'citation')).toHaveLength(2);
      expect(segments.at(-1)).toEqual({ kind: 'text', text: ' tail' });
    });

    it('degrades invalid marker bodies to text', () => {
      const raw = `${CITATION_MARKER_START}bad id here${CITATION_MARKER_END}`;
      expect(parseCitationSegments(raw)).toEqual([{ kind: 'text', text: raw }]);
    });

    it('returns plain text untouched when no markers exist', () => {
      const text = 'Ordinary [brackets] and [links](https://example.com) stay intact.';
      expect(parseCitationSegments(text)).toEqual([{ kind: 'text', text }]);
    });

    it('tolerates unterminated markers', () => {
      const text = `Claim.${CITATION_MARKER_START}get_quote-1 never closed`;
      expect(parseCitationSegments(text)).toEqual([{ kind: 'text', text }]);
    });
  });

  describe('buildCitationNumbering', () => {
    it('numbers by first appearance and deduplicates', () => {
      const numbering = buildCitationNumbering(['b-2', 'a-1', 'b-2']);
      expect(numbering.get('b-2')).toBe(1);
      expect(numbering.get('a-1')).toBe(2);
      expect(numbering.size).toBe(2);
    });

    it('appends block-only evidence after inline markers', () => {
      const numbering = buildCitationNumbering(['a-1'], ['c-3', 'a-1']);
      expect(numbering.get('a-1')).toBe(1);
      expect(numbering.get('c-3')).toBe(2);
      expect(numbering.size).toBe(2);
    });
  });
});
