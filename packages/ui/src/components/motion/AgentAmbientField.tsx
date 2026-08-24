import React, { useMemo, useRef } from 'react';
import { useMotionVisibility, usePrefersReducedMotion } from './useMotionVisibility';

export type AgentMotionState =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'synthesizing'
  | 'complete'
  | 'partial'
  | 'error';

interface AgentAmbientFieldProps {
  state: AgentMotionState;
  className?: string;
  particleCount?: number;
}

const DEFAULT_PARTICLE_COUNT = 28;

const stateClass: Record<AgentMotionState, string> = {
  idle: 'folio-motion-state--idle',
  thinking: 'folio-motion-state--thinking',
  tool: 'folio-motion-state--tool',
  synthesizing: 'folio-motion-state--synthesizing',
  complete: 'folio-motion-state--complete',
  partial: 'folio-motion-state--partial',
  error: 'folio-motion-state--error',
};

type ParticleStyle = React.CSSProperties & {
  '--particle-x': string;
  '--particle-y': string;
  '--particle-delay': string;
  '--particle-duration': string;
  '--particle-size': string;
};

/**
 * A deliberately quiet, DOM-only adaptation of the particle idea: no pointer
 * interaction, no per-frame React state, and a small fixed field of points.
 */
export const AgentAmbientField: React.FC<AgentAmbientFieldProps> = ({
  state,
  className = '',
  particleCount = DEFAULT_PARTICLE_COUNT,
}) => {
  const fieldRef = useRef<HTMLDivElement>(null);
  const paused = useMotionVisibility(fieldRef);
  const reducedMotion = usePrefersReducedMotion();
  const particles = useMemo(() => {
    const count = Math.max(0, Math.min(60, particleCount));
    return Array.from({ length: count }, (_, index) => {
      // A stable sequence keeps state changes from reshuffling the field.
      const seed = (index * 47 + 13) % 97;
      return {
        id: index,
        style: {
          '--particle-x': `${8 + ((seed * 17) % 84)}%`,
          '--particle-y': `${12 + ((seed * 29) % 74)}%`,
          '--particle-delay': `${-((seed % 31) / 3.1).toFixed(2)}s`,
          '--particle-duration': `${10 + (seed % 9)}s`,
          '--particle-size': `${2 + (seed % 3) * 0.45}px`,
        } as ParticleStyle,
      };
    });
  }, [particleCount]);

  const shouldRenderParticles = state !== 'idle' && state !== 'error';

  return (
    <div
      ref={fieldRef}
      aria-hidden="true"
      data-testid="agent-ambient-field"
      data-motion-state={state}
      data-paused={paused || reducedMotion ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className={`folio-motion-ambient ${stateClass[state]} ${className}`.trim()}
    >
      {shouldRenderParticles && <span className="folio-motion-ambient__halo" />}
      {shouldRenderParticles && particles.map((particle) => (
        <span key={particle.id} className="folio-motion-ambient__particle" style={particle.style} />
      ))}
    </div>
  );
};
