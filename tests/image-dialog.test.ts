import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { ImageDialog } from '../components/editor/document-dialogs';

const notices = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));
class PendingReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: ((reason: Error) => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  readAsDataURL() { readers.push(this); }
  abort() { this.aborted = true; this.onabort?.(); }
  // Allow late callbacks deliberately, even after cancellation.
  succeed(data: string) { this.result = data; this.onload?.(); }
  fail() { this.onerror?.(new Error('Read failed')); }
}
const readers: PendingReader[] = [];
let editor: Editor, engine: DocumentEngine, root: Root, host: HTMLDivElement, close: ReturnType<typeof vi.fn>;
const first = 'data:image/png;base64,QQ==', second = 'data:image/png;base64,Qg==';
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('FileReader', PendingReader);
  readers.length = 0; notices.error.mockReset();
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); close = vi.fn();
  await render(true);
});
afterEach(() => { act(() => root.unmount()); host.remove(); engine.destroy(); editor.destroy(); vi.unstubAllGlobals(); });
async function render(open: boolean) { await act(async () => root.render(createElement(ImageDialog, { open, close, editor, engine }))); }
async function choose(name: string, type = 'image/png') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['data'], name, { type })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const submitButton = () => document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
async function submit() { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it.each(['older first', 'older last'])('inserts only the newest selection when reading finishes %s', async order => {
  const before = editor.getJSON(); await choose('First.png'); await choose('Second.png');
  expect(readers[0].aborted).toBe(true);
  if (order === 'older first') {
    await act(async () => readers[0].succeed(first)); expect(submitButton().disabled).toBe(true);
    await act(async () => readers[1].succeed(second));
  } else {
    await act(async () => readers[1].succeed(second)); await act(async () => readers[0].succeed(first));
  }
  expect(document.querySelector<HTMLImageElement>('.image-preview')!.src).toBe(second);
  await submit();
  let image: Record<string, unknown> | undefined; editor.state.doc.descendants(node => { if (node.type.name === 'image') image = node.attrs; });
  expect(image).toMatchObject({ src: second, alt: 'Second.png' }); expect(close).toHaveBeenCalledOnce();
  engine.history('undo'); expect(editor.getJSON()).toEqual(before); expect(notices.error).not.toHaveBeenCalled();
});
it('does not populate a reopened dialog with a read from the previous dialog', async () => {
  await choose('Old.png'); await render(false); expect(readers[0].aborted).toBe(true); await render(true);
  await act(async () => readers[0].succeed(first));
  expect(document.querySelector('.image-preview')).toBeNull(); expect(submitButton().disabled).toBe(true);
  await choose('New.png'); await act(async () => readers[1].succeed(second));
  expect(document.querySelector<HTMLImageElement>('.image-preview')!.src).toBe(second);
});
it('ignores a read failure after unmounting and aborts the outstanding read', async () => {
  await choose('Old.png'); act(() => root.unmount());
  expect(readers[0].aborted).toBe(true); await act(async () => readers[0].fail());
  expect(notices.error).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it('preserves alternative text typed while the image is being read', async () => {
  await choose('Filename.png'); const input = document.querySelector<HTMLInputElement>('input[maxlength="500"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '用户填写 العربية');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => readers[0].succeed(first)); expect(input.value).toBe('用户填写 العربية');
});
it('allows choosing the same image after failure and never inserts while reading', async () => {
  const before = editor.getJSON(); await choose('Retry.png'); await submit();
  expect(editor.getJSON()).toEqual(before); expect(notices.error).not.toHaveBeenCalled();
  await act(async () => readers[0].fail()); expect(notices.error).toHaveBeenCalledWith('The image could not be read.');
  expect(submitButton().disabled).toBe(true);
  await choose('Retry.png'); await act(async () => readers[1].succeed(second));
  expect(submitButton().disabled).toBe(false); await submit(); expect(close).toHaveBeenCalledOnce();
});
it('rejects a newer unsupported file without later inserting the older pending image', async () => {
  const before = editor.getJSON(); await choose('Old.png'); await choose('Not-an-image.txt', 'text/plain');
  expect(readers[0].aborted).toBe(true); await act(async () => readers[0].succeed(first));
  expect(document.querySelector('.image-preview')).toBeNull(); expect(submitButton().disabled).toBe(true);
  await submit(); expect(editor.getJSON()).toEqual(before); expect(close).not.toHaveBeenCalled();
  expect(notices.error).toHaveBeenCalledExactlyOnceWith('Choose a supported image smaller than 2 MB.');
});
it('cancels reading immediately when Close is clicked, before the parent rerenders', async () => {
  await choose('Pending.png');
  await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  expect(close).toHaveBeenCalledOnce(); expect(readers[0].aborted).toBe(true);
  await act(async () => readers[0].succeed(first));
  expect(document.querySelector('.image-preview')).toBeNull(); expect(notices.error).not.toHaveBeenCalled();
});
it('still edits the selected image without inserting a new one or requiring a file read', async () => {
  await render(false);
  editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: first, alt: 'Original alt', width: 320 } }] });
  editor.commands.setNodeSelection(0); engine.captureSelection(); const before = editor.getJSON();
  await render(true); expect(document.querySelector('input[type="file"]')).toBeNull();
  const input = document.querySelector<HTMLInputElement>('input[maxlength="500"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Updated 中文');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit();
  const images: Record<string, unknown>[] = [];
  editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs); });
  expect(images).toHaveLength(1); expect(images[0]).toMatchObject({ src: first, alt: 'Updated 中文', width: 320 });
  expect(readers).toHaveLength(0); expect(close).toHaveBeenCalledOnce();
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
