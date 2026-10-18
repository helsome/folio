import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSyncI18n } from '@finagent/i18n';
import { I18nextProvider } from 'react-i18next';
import { installHappyDom } from '../../test/setupHappyDom';
import { AlertForm } from './AlertForm';

let restoreDom: (() => void) | undefined;

beforeAll(() => {
  restoreDom = installHappyDom().restore;
});

afterAll(() => {
  restoreDom?.();
});

async function renderForm(props: React.ComponentProps<typeof AlertForm>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nextProvider i18n={createSyncI18n({ locale: 'en-US' })}>
        <AlertForm {...props} />
      </I18nextProvider>
    );
  });
  return { container, root };
}

async function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount());
  container.remove();
}

/**
 * #328: the form owns the draft, so a failed save has to leave both the entered
 * values and a usable (never duplicated) submit path in place.
 */
describe('AlertForm', () => {
  it('shows the persist error inline and keeps the retry path enabled', async () => {
    const { container, root } = await renderForm({
      onSubmit: () => undefined,
      onCancel: () => undefined,
      error: 'The alert could not be saved, so it is not active. Your draft is still here — try again.',
    });

    const error = container.querySelector('[data-testid="alert-form-error"]');
    expect(error?.textContent).toContain('The alert could not be saved');
    expect(error?.getAttribute('role')).toBe('alert');

    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.textContent).toContain('Create Alert');

    await unmount(container, root);
  });

  it('blocks a second submit while the first one is pending', async () => {
    let submits = 0;
    const { container, root } = await renderForm({
      onSubmit: () => {
        submits += 1;
      },
      onCancel: () => undefined,
      pending: true,
    });

    // Validation runs from the default (empty) draft, so any accepted submit
    // would surface as an onSubmit call — pending must short-circuit first.
    await act(async () => {
      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(submits).toBe(0);
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toContain('Saving');

    await unmount(container, root);
  });
});
