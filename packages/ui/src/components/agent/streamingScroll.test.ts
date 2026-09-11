import { describe, expect, it } from 'bun:test';
import { isNearScrollBottom } from './streamingScroll';

describe('isNearScrollBottom', () => {
  it('follows output while the reader remains near the bottom', () => {
    expect(isNearScrollBottom({ scrollHeight: 1_000, scrollTop: 552, clientHeight: 400 })).toBe(true);
  });

  it('stops following after the reader scrolls away', () => {
    expect(isNearScrollBottom({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 400 })).toBe(false);
  });
});

