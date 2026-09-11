import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../test/setupHappyDom';
import { useStickToBottom, type StickToBottom } from './useStickToBottom';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/**
 * happy-dom has no layout engine, so we drive the hook with a plain object that
 * exposes just the geometry the hook reads. `scrollTo` is a no-op so the mount
 * auto-scroll does not overwrite the `scrollTop` under test.
 */
function fakeScroller(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLElement {
  return { scrollHeight, clientHeight, scrollTop, scrollTo: () => {} } as unknown as HTMLElement;
}

const Probe: React.FC<{
  refObject: React.RefObject<HTMLElement>;
  onState: (state: StickToBottom) => void;
}> = ({ refObject, onState }) => {
  onState(useStickToBottom(refObject, []));
  return null;
};

async function mountProbe(element: HTMLElement): Promise<{ get: () => StickToBottom | undefined }> {
  let state: StickToBottom | undefined;
  const refObject = { current: element } as React.RefObject<HTMLElement>;
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe refObject={refObject} onState={(next) => { state = next; }} />);
  });
  return { get: () => state };
}

describe('useStickToBottom', () => {
  it('is stuck when the viewport sits at the bottom', async () => {
    const probe = await mountProbe(fakeScroller(1000, 100, 900));
    expect(probe.get()?.isStuck).toBe(true);
  });

  it('releases the pin once the reader scrolls away from the bottom', async () => {
    const probe = await mountProbe(fakeScroller(1000, 100, 100));
    await act(async () => {
      probe.get()?.handleScroll();
    });
    expect(probe.get()?.isStuck).toBe(false);
  });

  it('re-pins when scrollToBottom is invoked', async () => {
    const probe = await mountProbe(fakeScroller(1000, 100, 100));
    await act(async () => {
      probe.get()?.handleScroll();
    });
    expect(probe.get()?.isStuck).toBe(false);

    await act(async () => {
      probe.get()?.scrollToBottom('auto');
    });
    expect(probe.get()?.isStuck).toBe(true);
  });
});
