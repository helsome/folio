import React, { useMemo, useRef } from 'react';
import { useMotionVisibility, usePrefersReducedMotion } from './useMotionVisibility';

interface SubtleDotFieldProps {
  className?: string;
  dotCount?: number;
}

type DotStyle = React.CSSProperties & {
  '--dot-x': string;
  '--dot-y': string;
  '--dot-delay': string;
};

/** A low-contrast scanning field for Discover's running state only. */
export const SubtleDotField: React.FC<SubtleDotFieldProps> = ({ className = '', dotCount = 32 }) => {
  const fieldRef = useRef<HTMLDivElement>(null);
  const paused = useMotionVisibility(fieldRef);
  const reducedMotion = usePrefersReducedMotion();
  const dots = useMemo(() => {
    const count = Math.max(12, Math.min(48, dotCount));
    return Array.from({ length: count }, (_, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      return {
        id: index,
        style: {
          '--dot-x': `${7 + column * 12.5}%`,
          '--dot-y': `${16 + row * 21}%`,
          '--dot-delay': `${-((index * 0.19) % 3.5).toFixed(2)}s`,
        } as DotStyle,
      };
    });
  }, [dotCount]);

  return (
    <div
      ref={fieldRef}
      aria-hidden="true"
      data-testid="subtle-dot-field"
      data-paused={paused || reducedMotion ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className={`folio-motion-dot-field ${className}`.trim()}
    >
      {dots.map((dot) => <span key={dot.id} className="folio-motion-dot-field__dot" style={dot.style} />)}
    </div>
  );
};
