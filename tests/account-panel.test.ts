import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountPanel } from '../components/account/account-panel';
let root: Root, mount: HTMLDivElement;
const fetcher = vi.fn();
const response = (body: unknown, status = 200) => Response.json(body, { status });
const button = (label: string) => Array.from(mount.querySelectorAll('button')).find(node => node.textContent === label)!;
const render = () => act(async () => root.render(createElement(AccountPanel)));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  window.history.replaceState(null, '', '/account');
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('recovers the old configured:false response through a visible retry', async () => {
  fetcher.mockResolvedValueOnce(response({ configured: false, user: null })).mockResolvedValueOnce(response({ configured: true, user: null }));
  await render();
  expect(button('Check again')).toBeDefined();
  expect(mount.textContent).not.toContain('not available on this address');
  await act(async () => button('Check again').click());
  expect(button('Continue with Google')).toBeDefined(); expect(mount.querySelector('[role="alert"]')).toBeNull();
});
it('shows setup failures without pretending a Google login is available', async () => {
  fetcher.mockResolvedValue(response({ configured: false, user: null, error: { code: 'AUTH_NOT_CONFIGURED' } }, 503));
  await render();
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('setup is incomplete');
  expect(button('Continue with Google')).toBeUndefined(); expect(button('Check again')).toBeDefined();
});
it('shows loading during a retry and clears the earlier failure after success', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('network unavailable')); await render();
  let complete!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => button('Check again').click());
  expect(mount.querySelector('[role="status"]')?.textContent).toContain('Checking your account');
  expect(button('Check again')).toBeUndefined();
  await act(async () => complete(response({ configured: true, user: null })));
  expect(button('Continue with Google')).toBeDefined();
});
it('turns a stalled request into a retryable error', async () => {
  vi.useFakeTimers();
  fetcher.mockImplementation((_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  await render(); await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(button('Check again')).toBeDefined(); expect(mount.querySelector('[role="status"]')).toBeNull();
});
it('keeps signed-in identity and the cloud workspace action prominent', async () => {
  fetcher.mockResolvedValue(response({ configured: true, user: { id: 'test', name: 'Philip', email: 'philip@example.test' } }));
  await render();
  expect(mount.querySelector('a[href="/cloud"]')?.textContent).toContain('Open cloud workspace');
  expect(mount.textContent).toContain('philip@example.test'); expect(button('Sign out')).toBeDefined();
  expect(mount.querySelector('details')?.open).toBe(false);
});
it('shows a failed sign-in and allows retry without navigating to an unexpected host', async () => {
  fetcher.mockResolvedValueOnce(response({ configured: true, user: null })).mockResolvedValueOnce(response({ url: 'https://unexpected.example' }));
  await render(); await act(async () => button('Continue with Google').click());
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('couldn’t start');
  expect(button('Continue with Google').disabled).toBe(false);
  expect(window.location.pathname).toBe('/account');
});
