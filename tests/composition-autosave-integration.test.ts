import { act, createElement, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { useInputComposition } from '../components/editor/use-input-composition';
import { useDocumentAutosave } from '../components/editor/use-document-autosave';

const calls = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../lib/infrastructure/persistence/document-store', () => ({ saveDocument: calls.save, STORAGE_KEY: 'vdoc.document.v1' }));
let editor: Editor, root: Root, mount: HTMLDivElement;
function TemporaryField() {
  const [visible, setVisible] = useState(true);
  return createElement('div', null,
    visible && createElement('input', { 'aria-label': 'Temporary field' }),
    createElement('button', { onClick: () => setVisible(false) }, 'Remove temporary field'));
}
function Harness() {
  const [title, setTitle] = useState('Original title'), [status, setStatus] = useState('');
  const body = useRef<HTMLDivElement>(null), blocked = useRef(false);
  const composition = useInputComposition();
  useDocumentAutosave(editor, 'composition-test', title, blocked, value => setStatus(value),
    { active: composition.hasComposition, subscribe: composition.subscribe });
  useEffect(() => { body.current!.appendChild(editor.view.dom); }, []);
  return createElement('div', composition.capture,
    createElement('input', { 'aria-label': 'Title', value: title, onChange: e => setTitle(e.target.value) }),
    createElement(TemporaryField),
    createElement('div', { ref: body }), createElement('span', { role: 'status' }, status));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); calls.save.mockReset().mockResolvedValue({});
  editor = new Editor({ extensions: createExtensions(), content: '<p>Original 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); vi.useFakeTimers();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Harness)));
  await tick();
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); mount.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick() { await act(async () => vi.advanceTimersByTimeAsync(450)); }
async function compose(target: HTMLElement, type: string) {
  await act(async () => target.dispatchEvent(new CompositionEvent(type, { bubbles: true })));
}
async function leave() {
  const event = new Event('beforeunload', { cancelable: true });
  await act(async () => window.dispatchEvent(event)); return event.defaultPrevented;
}
const status = () => mount.querySelector('[role="status"]')!.textContent;

it('connects title composition to save status and leave protection until its final title is persisted', async () => {
  const input = mount.querySelector('input')!;
  expect(status()).toBe('Saved locally'); await compose(input, 'compositionstart');
  expect(status()).toBe('Finishing input…'); expect(await leave()).toBe(true);
  expect(status()).not.toBe('Saved locally');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '完成 中文');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await tick(); expect(calls.save).toHaveBeenLastCalledWith('完成 中文', editor.getJSON(), 'composition-test');
  expect(status()).toBe('Saved locally'); expect(await leave()).toBe(false);
});
it('keeps body candidates guarded and recovers after cancellation without text changes', async () => {
  const before = editor.getJSON(); await compose(editor.view.dom, 'compositionstart');
  expect(status()).toBe('Finishing input…'); expect(await leave()).toBe(true);
  await compose(editor.view.dom, 'compositionend'); await tick();
  expect(editor.getJSON()).toEqual(before); expect(status()).toBe('Saved locally'); expect(await leave()).toBe(false);
});
it('clears a title candidate on blur and does not duplicate controllers on status rerenders', async () => {
  const input = mount.querySelector('input')!; await act(async () => input.focus());
  const count = calls.save.mock.calls.length;
  await compose(input, 'compositionstart'); await act(async () => input.blur()); await tick();
  expect(status()).toBe('Saved locally'); expect(calls.save).toHaveBeenCalledTimes(count + 1);
  expect(await leave()).toBe(false);
});
it('ignores queued composition completion after the workspace unmounts', async () => {
  const input = mount.querySelector('input')!; await compose(input, 'compositionstart');
  const count = calls.save.mock.calls.length;
  await act(async () => {
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); root.unmount();
  });
  await tick(); expect(calls.save).toHaveBeenCalledTimes(count); expect(await leave()).toBe(false);
});
it('resumes saving when a child removes its composing field without blur or compositionend', async () => {
  const field = mount.querySelector<HTMLInputElement>('[aria-label="Temporary field"]')!;
  const before = editor.getJSON(), count = calls.save.mock.calls.length;
  await compose(field, 'compositionstart'); expect(status()).toBe('Finishing input…');
  await act(async () => mount.querySelector('button')!.click());
  expect(field.isConnected).toBe(false);
  await tick();
  expect(status()).toBe('Saved locally');
  expect(calls.save).toHaveBeenCalledTimes(count + 1);
  expect(editor.getJSON()).toEqual(before); expect(await leave()).toBe(false);
});
it('does not clear a new candidate when the previous composing field is removed', async () => {
  const field = mount.querySelector<HTMLInputElement>('[aria-label="Temporary field"]')!;
  const title = mount.querySelector<HTMLInputElement>('[aria-label="Title"]')!;
  await compose(field, 'compositionstart');
  await act(async () => {
    mount.querySelector('button')!.click();
    title.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await tick(); expect(status()).toBe('Finishing input…'); expect(await leave()).toBe(true);
  await compose(title, 'compositionend'); await tick();
  expect(status()).toBe('Saved locally'); expect(await leave()).toBe(false);
});
it('keeps a candidate active when its field is only moved within the document', async () => {
  const field = mount.querySelector<HTMLInputElement>('[aria-label="Temporary field"]')!;
  await compose(field, 'compositionstart');
  await act(async () => { const parent = field.parentNode!; parent.removeChild(field); parent.appendChild(field); });
  await tick(); expect(status()).toBe('Finishing input…'); expect(await leave()).toBe(true);
  await compose(field, 'compositionend'); await tick();
  expect(status()).toBe('Saved locally'); expect(await leave()).toBe(false);
});
