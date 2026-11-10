import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Pixels from the bottom within which a live stream still counts as
 * "following". Matches the tolerance the agent panel has always used.
 */
export const AUTO_SCROLL_FOLLOW_THRESHOLD_PX = 24;

/** Distance in pixels between the current scroll position and the bottom. */
export function distanceFromBottom(body: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return body.scrollHeight - body.scrollTop - body.clientHeight;
}

/**
 * Whether a stream at `distance` from the bottom should keep following new
 * content. Overscroll (negative distance) still counts as following.
 */
export function shouldFollowStream(
  distance: number,
  threshold: number = AUTO_SCROLL_FOLLOW_THRESHOLD_PX,
): boolean {
  return distance <= threshold;
}

/**
 * Keep a streaming transcript pinned to the bottom while the user has not
 * scrolled away (#28).
 *
 * Following is armed on mount and re-armed whenever the user scrolls back to
 * the bottom; scrolling up disarms it until then, so new deltas never yank the
 * viewport away from what the user is reading. `deps` are the values whose
 * change should pull the view down (new messages, answer deltas, tool calls).
 */
export function useAutoScrollFollow(
  bodyRef: RefObject<HTMLElement | null>,
  endRef: RefObject<HTMLElement | null>,
  deps: unknown[],
): { onScroll: () => void } {
  const followingRef = useRef(true);

  useEffect(() => {
    if (!followingRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    // `deps` is the caller's change signal (messages / answer / tool calls).
  }, deps);

  const onScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    followingRef.current = shouldFollowStream(distanceFromBottom(body));
  }, [bodyRef]);

  return { onScroll };
}
