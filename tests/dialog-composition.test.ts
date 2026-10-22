import { act, createElement, Fragment, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';

let root: Root, mount: HTMLDivElement;
const escape = vi.fn(), submit = vi.fn(), captureSubmit = vi.fn(), otherSubmit = vi.fn();
function Harness() {
  const [open, setOpen] = useState(true);
  return createElement(Fragment, null,
    createElement('button', { 'data-testid': 'reopen', onClick: () => setOpen(true) }, 'Reopen'),
    createElement(Dialog, { open, onOpenChange: setOpen },
    createElement(DialogContent, { onEscapeKeyDown: escape, onSubmitCapture: captureSubmit },
      createElement(DialogTitle, null, 'Edit properties'),
      createElement(DialogDescription, null, 'Keep unfinished input'),
      createElement('form', { onSubmit: (event: React.FormEvent) => { event.preventDefault(); submit(); } },
        createElement('input', { 'aria-label': 'Draft', defaultValue: '保留未提交内容' }),
        createElement('button', { type: 'submit' }, 'Apply')),
      createElement('form', { 'data-testid': 'other-form', onSubmit: (event: React.FormEvent) => { event.preventDefault(); otherSubmit(); } },
        createElement('button', { type: 'submit' }, 'Other action')))));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); escape.mockReset(); submit.mockReset(); captureSubmit.mockReset(); otherSubmit.mockReset();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });
const input = () => document.querySelector<HTMLInputElement>('[aria-label="Draft"]')!;
async function key(flags: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...flags });
  await act(async () => input().dispatchEvent(event));
  return event;
}
it.each([{ isComposing: true }, { keyCode: 229 }])('retains the dialog and draft when Escape cancels an IME candidate: %j', async flags => {
  await key(flags);
  expect(input()?.value).toBe('保留未提交内容'); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(escape).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
});
it('tracks an active composition even when Escape has no IME keyboard flags, then restores normal dismissal', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await key(); expect(input()?.value).toBe('保留未提交内容'); expect(escape).not.toHaveBeenCalled();
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
  await key(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(escape).toHaveBeenCalledOnce();
});
it('keeps the ordinary Escape callback and its ability to prevent dismissal', async () => {
  escape.mockImplementation((event: KeyboardEvent) => event.preventDefault());
  await key(); expect(escape).toHaveBeenCalledOnce(); expect(input()?.value).toBe('保留未提交内容');
});
it('allows an explicit close button during composition', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('does not retain a removed input’s composition state after reopening', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="reopen"]')!.click());
  await key(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(escape).toHaveBeenCalledOnce();
});
it('clears composition tracking on blur so another control can dismiss normally', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('form button')!.focus());
  await key(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(escape).toHaveBeenCalledOnce();
});
async function submitDraft() {
  const event = new Event('submit', { bubbles: true, cancelable: true });
  await act(async () => input().form!.dispatchEvent(event));
  return event;
}
it('blocks form submission during active composition without consuming the candidate key, then submits after it ends', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  const enter = await key({ key: 'Enter' });
  expect(enter.defaultPrevented).toBe(false);
  const event = await submitDraft();
  expect(event.defaultPrevented).toBe(true); expect(submit).not.toHaveBeenCalled(); expect(captureSubmit).not.toHaveBeenCalled();
  expect(input().value).toBe('保留未提交内容');
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await submitDraft(); expect(submit).toHaveBeenCalledOnce(); expect(captureSubmit).toHaveBeenCalledOnce();
});
it('allows explicit submission after the composing field loses focus', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => {
    const button = input().form!.querySelector<HTMLButtonElement>('button')!;
    button.focus(); button.click();
  });
  expect(submit).toHaveBeenCalledOnce(); expect(captureSubmit).toHaveBeenCalledOnce();
});
it('does not block a different form because another field is composing', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => document.querySelector('[data-testid="other-form"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(otherSubmit).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
});
it('does not block submitting a reopened form because its old composing input was removed', async () => {
  await act(async () => input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="reopen"]')!.click());
  await submitDraft(); expect(submit).toHaveBeenCalledOnce();
});
it('preserves the caller capture handler and its ability to stop an ordinary submission', async () => {
  captureSubmit.mockImplementation(event => { event.preventDefault(); event.stopPropagation(); });
  await submitDraft(); expect(captureSubmit).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
});
