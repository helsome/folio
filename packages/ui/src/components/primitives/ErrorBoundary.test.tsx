import { afterAll, describe, expect, it } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ErrorBoundary } from './ErrorBoundary';
import { installHappyDom } from '../../test/setupHappyDom';

const happyDom = installHappyDom();
afterAll(() => happyDom.restore());

let shouldThrow = true;

function Flaky(): React.ReactElement {
  if (shouldThrow) throw new Error('boom');
  return <div>recovered</div>;
}

function renderBoundary(children: React.ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ErrorBoundary>{children}</ErrorBoundary>);
  });
  return { container, root };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text
  );
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

describe('ErrorBoundary', () => {
  it('renders the fallback when a child throws instead of crashing', () => {
    shouldThrow = true;
    const { container } = renderBoundary(<Flaky />);
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Retry');
    expect(container.textContent).toContain('Open Diagnostics');
  });

  it('renders healthy children through untouched', () => {
    shouldThrow = false;
    const { container } = renderBoundary(<Flaky />);
    expect(container.textContent).toContain('recovered');
    expect(container.textContent).not.toContain('Something went wrong');
  });

  it('retry resets the boundary so a recovered child renders again', () => {
    shouldThrow = true;
    const { container } = renderBoundary(<Flaky />);
    expect(container.textContent).toContain('Something went wrong');

    // The child stops throwing; Retry must clear the boundary and re-render it.
    shouldThrow = false;
    const retry = buttonByText(container, 'Retry');
    act(() => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('recovered');
    expect(container.textContent).not.toContain('Something went wrong');
  });
});
