import { describe, expect, it } from 'bun:test';
import { severityVisual } from './portfolioRiskAtoms';

describe('severityVisual', () => {
  it('maps high severity to red', () => {
    expect(severityVisual('high')).toEqual({
      tone: 'high',
      color: 'var(--mac-red)',
      label: 'High',
    });
  });

  it('maps medium severity to yellow', () => {
    expect(severityVisual('medium')).toEqual({
      tone: 'medium',
      color: 'var(--mac-yellow)',
      label: 'Medium',
    });
  });

  it('maps low severity to green', () => {
    expect(severityVisual('low')).toEqual({
      tone: 'low',
      color: 'var(--mac-green)',
      label: 'Low',
    });
  });
});
