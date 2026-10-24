import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountMenu } from '../components/editor/account-menu';

const calls = vi.hoisted(() => ({ cloud: false }));
vi.mock('../lib/composition/repositories', () => ({ isCloudWorkspace: () => calls.cloud }));
let root: Root, mount: HTMLDivElement;
const respond = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })));
const render = () => act(async () => { root.render(createElement(AccountMenu)); await new Promise(resolve => setTimeout(resolve, 0)); });
const avatar = () => mount.querySelector<HTMLAnchorElement>('[aria-label="Your account"]')!;
const reveal = () => act(async () => { avatar().focus(); });
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); calls.cloud = false; mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); });
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });

it('shows the signed-in account with workspace links and sign-out', async () => {
  respond({ configured: true, user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } });
  await render();
  expect(avatar().textContent).toBe('A'); expect(avatar().getAttribute('href')).toBe('/account');
  expect(mount.querySelector('[role="dialog"]')).toBeNull();
  await reveal();
  const card = mount.querySelector('[role="dialog"]')!;
  expect(card.textContent).toContain('Ada Lovelace'); expect(card.textContent).toContain('ada@example.com');
  expect([...card.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/cloud', '/account']);
  expect(card.textContent).toContain('Sign out');
});
it('offers sign-in when no one is signed in, and closes on Escape', async () => {
  calls.cloud = true; respond({ configured: true, user: null });
  await render(); await reveal();
  const card = mount.querySelector('[role="dialog"]')!;
  expect(card.textContent).toContain('Writing locally'); expect(card.textContent).not.toContain('Sign out');
  expect([...card.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['/account', '/']);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(mount.querySelector('[role="dialog"]')).toBeNull();
});
