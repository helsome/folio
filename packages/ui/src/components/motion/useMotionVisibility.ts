import { useEffect, useState } from 'react';

/**
 * Ambient layers are decorative, so they should stop doing work when the user
 * cannot see them. The hook intentionally updates only on visibility changes;
 * it never participates in an animation frame.
 */
export function useMotionVisibility(elementRef: React.RefObject<HTMLElement>): boolean {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let intersecting = true;
    const update = () => setPaused(document.hidden || !intersecting);
    const onVisibilityChange = () => update();
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (typeof IntersectionObserver === 'undefined') {
      update();
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(element);
    update();

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [elementRef]);

  return paused;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return reduced;
}
