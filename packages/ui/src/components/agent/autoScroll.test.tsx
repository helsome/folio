import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { installHappyDom } from '../../test/setupHappyDom';
import {
  AUTO_SCROLL_FOLLOW_THRESHOLD_PX,
  distanceFromBottom,
  shouldFollowStream,
  useAutoScrollFollow,
} from './autoScroll';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

/**
 * A scroll container whose geometry the test controls. happy-dom does not lay
 * out, so scroll metrics are defined directly on the elements.
 */
function defineGeometry(body: HTMLDivElement): void {
  Object.defineProperty(body, 'scrollHeight', { value: 1000, configurable: true, writable: true });
  Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true, writable: true });
  Object.defineProperty(body, 'scrollTop', { value: 600, configurable: true, writable: true });
}

let scrollIntoViewCalls = 0;

const Harness: React.FC = () => {
  // Plain mutable objects: the test configures the elements from ref
  // callbacks, which run before effects, so the hook always sees real nodes.
  // Stable callbacks keep React from re-attaching (and re-configuring) the
  // elements on every render.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [dep, setDep] = React.useState(0);
  const { onScroll } = useAutoScrollFollow(bodyRef, endRef, [dep]);
  HarnessControls.setDep = setDep;
  const attachBody = React.useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    if (element) defineGeometry(element);
  }, []);
  const attachEnd = React.useCallback((element: HTMLDivElement | null) => {
    endRef.current = element;
    if (element) {
      element.scrollIntoView = () => {
        scrollIntoViewCalls += 1;
      };
    }
  }, []);
  return (
    <div ref={attachBody} onScroll={onScroll} data-testid="body">
      <div ref={attachEnd} />
    </div>
  );
};

const HarnessControls: { setDep: (value: number) => void } = { setDep: () => {} };

async function mountHarness(): Promise<{ root: Root; body: () => HTMLDivElement }> {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  return {
    root,
    body: () => (container.querySelector('[data-testid="body"]') as HTMLDivElement) ?? container,
  };
}

describe('auto-scroll follow policy (#28)', () => {
  it('measures the distance to the bottom of a scroll container', () => {
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(0);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 })).toBe(600);
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 990, clientHeight: 400 })).toBe(-390);
  });

  it('follows while at the bottom and stops once the user scrolls away', () => {
    expect(shouldFollowStream(0)).toBe(true);
    expect(shouldFollowStream(AUTO_SCROLL_FOLLOW_THRESHOLD_PX)).toBe(true);
    expect(shouldFollowStream(AUTO_SCROLL_FOLLOW_THRESHOLD_PX + 0.5)).toBe(false);
    expect(shouldFollowStream(600)).toBe(false);
    // Overscroll (rubber-banding) still counts as being at the bottom.
    expect(shouldFollowStream(-10)).toBe(true);
  });

  it('keeps following while the user stays at the bottom', async () => {
    scrollIntoViewCalls = 0;
    const { root, body } = await mountHarness();
    // Mount arms following and pulls to the bottom once.
    expect(scrollIntoViewCalls).toBe(1);

    // New content while still at the bottom keeps following.
    await act(async () => {
      HarnessControls.setDep(1);
    });
    expect(scrollIntoViewCalls).toBe(2);
    expect(body().scrollTop).toBe(600);

    await act(async () => {
      root.unmount();
    });
  });

  it('does not yank the viewport back after the user scrolls away, and re-arms at the bottom', async () => {
    scrollIntoViewCalls = 0;
    const { root, body } = await mountHarness();
    expect(scrollIntoViewCalls).toBe(1);

    // The user scrolls up: 600px away from the bottom disarms following.
    const bodyElement = body();
    bodyElement.scrollTop = 0;
    await act(async () => {
      bodyElement.dispatchEvent(new Event('scroll'));
    });

    // New streamed content must not pull the viewport back down.
    await act(async () => {
      HarnessControls.setDep(1);
    });
    expect(scrollIntoViewCalls).toBe(1);
    expect(bodyElement.scrollTop).toBe(0);

    // Scrolling back to the bottom re-arms following.
    bodyElement.scrollTop = 600;
    await act(async () => {
      bodyElement.dispatchEvent(new Event('scroll'));
    });
    await act(async () => {
      HarnessControls.setDep(2);
    });
    expect(scrollIntoViewCalls).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });
});
