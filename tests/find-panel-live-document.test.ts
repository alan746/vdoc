import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { FindPanel } from '../components/editor/editing-panels';
import * as searchScroll from '../lib/editor/search-scroll';

let editor: Editor, engine: DocumentEngine, root: Root;
const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
const status = () => document.querySelector('[role="status"]')?.textContent;
const close = vi.fn();
async function input(label: string, value: string) {
  await act(async () => {
    const el = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  close.mockClear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  editor = new Editor({ extensions: createExtensions(), content: '<p>Find one 中文</p><p>Find two العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  const mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close })));
  await input('Find text', 'Find'); await input('Replace with', 'Changed');
});
afterEach(() => { act(() => root.unmount()); engine.destroy(); editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['Find text', 'Replace with', 'Next', 'Match case'])('closes from %s with Escape and returns focus to the unchanged selected text', async label => {
  document.body.appendChild(editor.view.dom);
  const target = label === 'Next' ? button(label) : label === 'Match case'
    ? document.querySelector<HTMLInputElement>('input[type="checkbox"]')! : field(label);
  const before = editor.getJSON(), selection = editor.state.selection;
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => { target.focus(); target.dispatchEvent(event); });
  expect(close).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.eq(selection)).toBe(true);
});

it.each(['tracked', 'flagged'])('preserves replacement candidates and drafts on %s composition Escape', async mode => {
  const target = field('Replace with'), before = editor.getJSON();
  await act(async () => {
    target.focus();
    if (mode === 'tracked') target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: mode === 'flagged' });
  await act(async () => target.dispatchEvent(event));
  expect(close).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(target); expect(target.value).toBe('Changed');
  expect(editor.getJSON()).toEqual(before);
  if (mode === 'tracked') await act(async () => target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
});

it('returns focus to the document when the close button is clicked without applying a replacement', async () => {
  document.body.appendChild(editor.view.dom);
  const before = editor.getJSON(), selection = editor.state.selection;
  await act(async () => {
    field('Replace with').focus();
    document.querySelector<HTMLButtonElement>('[aria-label="Close find and replace"]')!.click();
  });
  expect(close).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.eq(selection)).toBe(true);
});

it.each(['Enter', 'Escape'])('does not act on flagless %s during an active search composition', async key => {
  const el = field('Find text'), before = editor.getJSON(), selection = editor.state.selection;
  await act(async () => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  expect(status()).toBe('1 of 2'); expect(close).not.toHaveBeenCalled();
  expect(editor.state.selection.eq(selection)).toBe(true); expect(editor.getJSON()).toEqual(before);
  await act(async () => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  if (key === 'Enter') expect(status()).toBe('2 of 2');
  else expect(close).toHaveBeenCalledOnce();
});

it('clears search composition after focus leaves and preserves both drafts', async () => {
  const el = field('Find text');
  await act(async () => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => { field('Replace with').focus(); el.focus(); });
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(status()).toBe('2 of 2'); expect(el.value).toBe('Find');
  expect(field('Replace with').value).toBe('Changed');
});

it('cannot replace an old range when an edit arrives before the panel renders', async () => {
  await act(async () => {
    editor.commands.insertContentAt(1, 'Prefix 👩‍💻 ');
    button('Replace').click();
  });
  expect(editor.state.doc.textContent).toBe('Prefix 👩‍💻 Find one 中文Find two العربية');
  await act(async () => button('Replace').click());
  expect(editor.state.doc.textContent).toBe('Prefix 👩‍💻 Changed one 中文Find two العربية');
});

it('does not corrupt the first replacement when two clicks arrive before a render', async () => {
  await act(async () => { button('Replace').click(); button('Replace').click(); });
  expect(editor.state.doc.textContent).toBe('Changed one 中文Find two العربية');
  expect(status()).toBe('1 of 1');
  await act(async () => button('Replace').click());
  expect(editor.state.doc.textContent).toBe('Changed one 中文Changed two العربية');
  expect(status()).toBe('No matches');
});

it('updates count and highlights after editing and undo without a parent refresh', async () => {
  await act(async () => button('Replace').click());
  expect(status()).toBe('1 of 1');
  expect(editor.view.dom.querySelectorAll('.vdoc-search-match')).toHaveLength(1);
  await act(async () => { engine.history('undo'); });
  expect(status()).toBe('1 of 2');
  expect(editor.view.dom.querySelectorAll('.vdoc-search-match')).toHaveLength(2);
});

it('disables replacing when an outside edit removes every match', async () => {
  await act(async () => { editor.commands.setContent('<p>No target 中文</p>'); });
  expect(status()).toBe('No matches');
  expect(button('Replace').disabled).toBe(true); expect(button('Replace all').disabled).toBe(true);
  expect(editor.view.dom.querySelector('.vdoc-search-match')).toBeNull();
});

it('does not navigate to stale coordinates while an outside edit is pending render', async () => {
  await act(async () => {
    editor.commands.insertContentAt(1, 'Prefix 👩‍💻 ');
    const selection = editor.state.selection;
    button('Next').click();
    expect(editor.state.selection.eq(selection)).toBe(true);
  });
  await act(async () => button('Next').click());
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('Find');
});

it.each([['café', 'cafe\u0301'], ['العربية', 'العربية'], ['👩‍💻', '👩‍💻']])('replaces successive %s matches using their current Unicode ranges and undoes exactly', async (query, text) => {
  await act(async () => { editor.commands.setContent(`<p>${text} / ${text}</p>`); });
  await input('Find text', query); await input('Replace with', '已替换');
  await act(async () => button('Replace').click());
  const first = editor.getJSON();
  expect(editor.state.doc.textContent).toBe(`已替换 / ${text}`); expect(status()).toBe('1 of 1');
  await act(async () => button('Replace').click());
  expect(editor.state.doc.textContent).toBe('已替换 / 已替换'); expect(status()).toBe('No matches');
  await act(async () => { engine.history('undo'); });
  expect(editor.getJSON()).toEqual(first); expect(status()).toBe('1 of 1');
});

it.each(['Next', 'Previous', 'Enter', 'Shift+Enter'])('navigates from the displayed match after results shrink: %s', async action => {
  await act(async () => { editor.commands.setContent('<p>Find one</p><p>Find two</p><p>Find three</p><p>Find four</p><p>Find five</p>'); });
  for (let i = 0; i < 4; i++) await act(async () => button('Next').click());
  expect(status()).toBe('5 of 5');
  await act(async () => { editor.commands.setContent('<p>Find one</p><p>Find two</p>'); });
  expect(status()).toBe('2 of 2');
  const before = editor.getJSON();
  await act(async () => {
    if (action === 'Next' || action === 'Previous') button(action).click();
    else field('Find text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: action === 'Shift+Enter', bubbles: true }));
  });
  expect(status()).toBe('1 of 2');
  expect(editor.view.dom.querySelector('.vdoc-search-current')?.parentElement?.textContent).toBe('Find one');
  expect(editor.getJSON()).toEqual(before);
});

it('keeps the editing caret and focus while search results update in the background', async () => {
  document.body.appendChild(editor.view.dom);
  await act(async () => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  await act(async () => { editor.commands.insertContent(' / Find new 中文'); });
  const selection = editor.state.selection;
  expect(status()).toBe('1 of 3');
  expect(document.activeElement).toBe(editor.view.dom);
  expect(selection.empty).toBe(true);
  expect(editor.state.doc.textBetween(selection.from - 3, selection.from)).toBe(' 中文');
});

it('refocuses and selects the existing query when Find is requested again without clearing replacement or editing content', async () => {
  field('Replace with').focus();
  const before = editor.getJSON(), selection = editor.state.selection;
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close: () => {}, focusRequest: 1 })));
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(document.activeElement).toBe(field('Find text'));
  expect(field('Find text').selectionStart).toBe(0); expect(field('Find text').selectionEnd).toBe(4);
  expect(field('Replace with').value).toBe('Changed'); expect(status()).toBe('1 of 2');
  expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.eq(selection)).toBe(true);
});

it('does not steal focus if the user starts another action before the deferred menu focus', async () => {
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close: () => {}, focusRequest: 1 })));
  field('Replace with').focus();
  field('Replace with').dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(document.activeElement).toBe(field('Replace with'));
});

it.each([
  ['Find text', 'Replace'], ['Find text', 'Replace all'],
  ['Replace with', 'Replace'], ['Replace with', 'Replace all'],
] as const)('does not apply %s candidates through %s before composition ends, then replaces the final draft once', async (label, action) => {
  const target = field(label), before = editor.getJSON(), revision = engine.revision;
  await act(async () => { target.focus(); target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await act(async () => button(action).click());
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
  expect(target.value).toBe(label === 'Find text' ? 'Find' : 'Changed');
  expect(close).not.toHaveBeenCalled();
  await input(label, label === 'Find text' ? 'two' : '最终文本 العربية');
  await act(async () => target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => button(action).click());
  expect(editor.getText()).toContain(label === 'Find text' ? 'Find Changed العربية' : '最终文本 العربية one 中文');
  if (label === 'Replace with') expect(editor.getText()).toContain(action === 'Replace all' ? '最终文本 العربية two العربية' : 'Find two العربية');
  await act(async () => { engine.history('undo'); }); expect(editor.getJSON()).toEqual(before);
});
it.each(['Find text', 'Replace with'])('keeps the panel draft when Close is activated during %s composition and closes after completion', async label => {
  const target = field(label), before = editor.getJSON();
  await act(async () => { target.focus(); target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close find and replace"]')!.click());
  expect(close).not.toHaveBeenCalled(); expect(editor.getJSON()).toEqual(before);
  expect(target.value).toBe(label === 'Find text' ? 'Find' : 'Changed');
  await act(async () => target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close find and replace"]')!.click());
  expect(close).toHaveBeenCalledOnce(); expect(editor.getJSON()).toEqual(before);
});
it.each(['Replace', 'Replace all'])('retains both drafts and exact content if %s is rejected while read-only, then retries in one undo step', async action => {
  const before = editor.getJSON(), revision = engine.revision;
  editor.setEditable(false, false); await act(async () => button(action).click());
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
  expect(field('Find text').value).toBe('Find'); expect(field('Replace with').value).toBe('Changed');
  editor.setEditable(true, false); await act(async () => button(action).click());
  expect(editor.getText()).toContain('Changed one 中文');
  expect(editor.getText()).toContain(action === 'Replace all' ? 'Changed two العربية' : 'Find two العربية');
  await act(async () => { engine.history('undo'); }); expect(editor.getJSON()).toEqual(before);
});
it('allows explicit replacement after a candidate field loses focus without leaving a stale input guard', async () => {
  const before = editor.getJSON(), target = field('Replace with');
  await act(async () => { target.focus(); target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await input('Replace with', 'Blur committed 中文');
  await act(async () => field('Find text').focus());
  await act(async () => button('Replace all').click());
  expect(editor.getText()).toContain('Blur committed 中文 one 中文'); expect(editor.getText()).toContain('Blur committed 中文 two العربية');
  await act(async () => { engine.history('undo'); }); expect(editor.getJSON()).toEqual(before);
});

it.each([
  ['Find text', 'Next'], ['Find text', 'Previous'], ['Replace with', 'Next'], ['Replace with', 'Previous'],
] as const)('preserves the selected match while %s composes and %s is activated, then permits navigation', async (label, action) => {
  const target = field(label), before = editor.getJSON(), selected = editor.state.selection;
  await act(async () => { target.focus(); target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await act(async () => button(action).click());
  expect(status()).toBe('1 of 2'); expect(editor.state.selection.eq(selected)).toBe(true); expect(editor.getJSON()).toEqual(before);
  await act(async () => target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => button(action).click()); expect(status()).toBe('2 of 2'); expect(editor.getJSON()).toEqual(before);
});
it.each(['Next', 'Previous'])('does not move the body candidate selection through %s and resumes after the input completes', async action => {
  let composing = true; Object.defineProperty(editor.view, 'composing', { configurable: true, get: () => composing });
  const before = editor.getJSON(), selected = editor.state.selection;
  await act(async () => button(action).click()); expect(status()).toBe('1 of 2'); expect(editor.state.selection.eq(selected)).toBe(true);
  composing = false; await act(async () => button(action).click()); expect(status()).toBe('2 of 2'); expect(editor.getJSON()).toEqual(before);
});
it.each(['Find text', 'Replace with'])('does not refocus or select the query when %s composition starts before deferred menu focus', async label => {
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close, focusRequest: 1 })));
  const target = field(label), before = editor.getJSON();
  await act(async () => { target.focus(); target.setSelectionRange(2, 2); target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(document.activeElement).toBe(target); expect(target.selectionStart).toBe(2); expect(target.selectionEnd).toBe(2);
  expect(editor.getJSON()).toEqual(before);
  await act(async () => target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close, focusRequest: 2 })));
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(document.activeElement).toBe(field('Find text')); expect(field('Find text').selectionEnd).toBe(4);
});
it.each(['body', 'panel'])('does not execute deferred search scrolling after a new %s candidate starts', async location => {
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const reveal = vi.spyOn(searchScroll, 'revealSearchMatch').mockImplementation(() => {});
  await act(async () => button('Next').click()); expect(reveal).toHaveBeenCalledOnce();
  let composing = true;
  if (location === 'body') Object.defineProperty(editor.view, 'composing', { configurable: true, get: () => composing });
  else await act(async () => { field('Replace with').focus(); field('Replace with').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  const selected = editor.state.selection;
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(reveal).toHaveBeenCalledOnce(); expect(editor.state.selection.eq(selected)).toBe(true);
  composing = false;
  if (location === 'panel') await act(async () => field('Replace with').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => button('Next').click()); expect(reveal).toHaveBeenCalledTimes(2);
});
it('updates live match counts without moving a body candidate when the search query changes', async () => {
  let composing = true; Object.defineProperty(editor.view, 'composing', { configurable: true, get: () => composing });
  const selected = editor.state.selection, before = editor.getJSON();
  await input('Find text', 'two'); expect(status()).toBe('1 of 1'); expect(editor.state.selection.eq(selected)).toBe(true);
  composing = false; await act(async () => button('Next').click());
  expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('two'); expect(editor.getJSON()).toEqual(before);
});

it('reveals the current match after zoom changes without resetting its index, selection, content or focus', async () => {
  await act(async () => button('Next').click());
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const selected = editor.state.selection, before = editor.getJSON();
  field('Replace with').focus();
  const reveal = vi.spyOn(searchScroll, 'revealSearchMatch').mockImplementation(() => {});
  for (const zoom of [125, 100]) {
    reveal.mockClear();
    await act(async () => root.render(createElement(FindPanel, { editor, engine, close, zoom })));
    expect(reveal).toHaveBeenCalledWith(editor, selected.from);
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(status()).toBe('2 of 2');
    expect(editor.state.selection.eq(selected)).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(document.activeElement).toBe(field('Replace with'));
  }
});

it.each(['body', 'panel', 'no matches'])('does not move the viewport during %s when zoom changes', async location => {
  if (location === 'no matches') await input('Find text', 'absent');
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  if (location === 'body') Object.defineProperty(editor.view, 'composing', { configurable: true, get: () => true });
  if (location === 'panel') await act(async () => field('Find text').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  const selected = editor.state.selection, before = editor.getJSON();
  const reveal = vi.spyOn(searchScroll, 'revealSearchMatch').mockImplementation(() => {});
  await act(async () => root.render(createElement(FindPanel, { editor, engine, close, zoom: 125 })));
  await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  expect(reveal).not.toHaveBeenCalled();
  expect(editor.state.selection.eq(selected)).toBe(true); expect(editor.getJSON()).toEqual(before);
});
