import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const DEFAULT_THRESHOLD_PX = 48;

export interface StickToBottom {
  /** True while the viewport is pinned to the bottom of the scroll container. */
  isStuck: boolean;
  /** Attach to the scroll container's `onScroll`. */
  handleScroll: () => void;
  /** Re-pin to the bottom (used by the "jump to latest" affordance). */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Keep a scroll container pinned to its bottom while new content streams in —
 * but ONLY while the reader is already near the bottom. Once the reader scrolls
 * up to read earlier content, new output must never yank the viewport back down
 * (issue #28). Scrolling back to the bottom, or calling `scrollToBottom`,
 * restores the pinned state.
 *
 * Auto-scroll respects `prefers-reduced-motion`, and falls back to assigning
 * `scrollTop` where `Element.scrollTo` is unavailable (e.g. happy-dom).
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLElement>,
  deps: ReadonlyArray<unknown>,
  threshold: number = DEFAULT_THRESHOLD_PX,
): StickToBottom {
  const stickRef = useRef(true);
  const [isStuck, setIsStuck] = useState(true);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const stuck = distance <= threshold;
    stickRef.current = stuck;
    setIsStuck((previous) => (previous === stuck ? previous : stuck));
  }, [scrollRef, threshold]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const element = scrollRef.current;
      if (!element) return;
      stickRef.current = true;
      setIsStuck(true);
      const resolved: ScrollBehavior = prefersReducedMotion() ? 'auto' : behavior;
      if (typeof element.scrollTo === 'function') {
        element.scrollTo({ top: element.scrollHeight, behavior: resolved });
      } else {
        element.scrollTop = element.scrollHeight;
      }
    },
    [scrollRef],
  );

  useEffect(() => {
    if (!stickRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    const resolved: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: resolved });
    } else {
      element.scrollTop = element.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { isStuck, handleScroll, scrollToBottom };
}
