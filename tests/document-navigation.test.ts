import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { documentNavigation } from '../lib/editor/document-navigation';

let editor: Editor;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => editor.destroy());

it('shares synchronous ownership for one editor and permits editing while reading', () => {
  const first = documentNavigation(editor), second = documentNavigation(editor);
  expect(first.acquire()).toBe(true); expect(second.acquire()).toBe(false);
  editor.commands.insertContent('Latest '); expect(editor.getText()).toContain('Latest');
  first.release(); expect(second.acquire()).toBe(true); second.release();
});
it('blocks direct writes and engine history during commit without changing the draft or undo history', () => {
  editor.commands.insertContent('Saved edit ');
  const engine = new DocumentEngine(editor), navigation = documentNavigation(editor), before = editor.getJSON();
  navigation.acquire(); navigation.freeze();
  expect(editor.isEditable).toBe(false); editor.commands.insertContent('Must not enter'); editor.commands.undo();
  expect(engine.history('undo').ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  navigation.release(); expect(editor.isEditable).toBe(true); editor.commands.undo(); expect(editor.getText()).toBe('Keep 中文 العربية'); engine.destroy();
});
it('restores an originally read-only editor to read-only after releasing', () => {
  editor.setEditable(false); const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze(); navigation.release();
  expect(editor.isEditable).toBe(false);
});
it('refuses to freeze an unfinished composition and can retry after it ends', () => {
  const navigation = documentNavigation(editor); navigation.acquire();
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true });
  expect(() => navigation.freeze()).toThrow('Finish composing'); expect(editor.isEditable).toBe(true); navigation.release();
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: false });
  expect(navigation.acquire()).toBe(true); navigation.freeze(); navigation.release(); expect(editor.isEditable).toBe(true);
});
it('releases safely after an editor is destroyed', () => {
  const navigation = documentNavigation(editor); navigation.acquire(); navigation.freeze(); editor.destroy();
  expect(() => navigation.release()).not.toThrow(); expect(navigation.acquire()).toBe(false);
});
it('checks registered input composition at freeze time and permits retry after it ends', () => {
  const navigation = documentNavigation(editor); let composing = false;
  const unregister = navigation.registerCompositionGuard(() => composing);
  navigation.acquire(); composing = true;
  expect(() => navigation.freeze()).toThrow('Finish composing');
  expect(editor.isEditable).toBe(true); expect(navigation.getSnapshot()).toBe('reading');
  navigation.release(); expect(navigation.isComposing()).toBe(true);
  composing = false; navigation.acquire(); navigation.freeze(); navigation.release();
  expect(editor.isEditable).toBe(true); unregister();
});
it('removes only the unmounted input guard without losing other composition protection', () => {
  const navigation = documentNavigation(editor);
  const first = navigation.registerCompositionGuard(() => true);
  const second = navigation.registerCompositionGuard(() => true);
  first(); expect(navigation.isComposing()).toBe(true);
  second(); expect(navigation.isComposing()).toBe(false);
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true });
  expect(navigation.isComposing()).toBe(true);
});
