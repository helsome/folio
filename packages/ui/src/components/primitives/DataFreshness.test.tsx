import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installHappyDom } from '../../test/setupHappyDom';
import { DataFreshness } from './DataFreshness';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

function renderText(element: React.ReactElement): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container.textContent ?? '';
}

describe('DataFreshness', () => {
  it('renders provider + updated time when a timestamp is present', () => {
    const text = renderText(<DataFreshness providerName="Longbridge" updatedAtMs={1_700_000_000_000} />);
    expect(text).toMatch(/Longbridge · Updated/);
  });

  it('appends a Delayed marker when flagged', () => {
    const text = renderText(<DataFreshness providerName="Massive" updatedAtMs={1_700_000_000_000} delayed />);
    expect(text).toContain('· Delayed');
  });

  it('renders nothing without a valid timestamp', () => {
    expect(renderText(<DataFreshness providerName="Longbridge" />)).toBe('');
    expect(renderText(<DataFreshness providerName="Longbridge" updatedAtMs={NaN} />)).toBe('');
    expect(renderText(<DataFreshness providerName="Longbridge" updatedAtMs={0} />)).toBe('');
  });
});
