import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { AgentActivity, clearAgentActivity, highlightChangedBlocks, setAgentPresence } from '../lib/editor/realtime/agent-activity';

let editor: Editor;
beforeEach(async () => {
  editor = new Editor({ extensions: [...createExtensions(), AgentActivity], content: '<p>first</p><p>second</p><p>third</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); vi.useRealTimers(); });
const blockIds = () => { const ids: string[] = []; editor.state.doc.descendants(node => { if (node.attrs.blockId && node.isTextblock) ids.push(node.attrs.blockId); }); return ids; };

it('highlights the changed blocks and clears itself after the duration, without touching the document', () => {
  vi.useFakeTimers();
  const before = editor.getJSON();
  const [first, , third] = blockIds();
  highlightChangedBlocks(editor, [first, third], 1500);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight')).toHaveLength(2);
  expect(editor.getJSON()).toEqual(before);
  vi.advanceTimersByTime(1500);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight')).toHaveLength(0);
  expect(editor.getJSON()).toEqual(before);
});

it('maps the highlight through a later edit instead of losing it', () => {
  vi.useFakeTimers();
  const [, second] = blockIds();
  highlightChangedBlocks(editor, [second], 1500);
  editor.commands.insertContentAt(0, 'X');
  expect(editor.view.dom.querySelector('.vdoc-agent-highlight')?.textContent).toBe('second');
  vi.advanceTimersByTime(1500);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight')).toHaveLength(0);
});

it('does not let an older highlight’s timeout clear a newer one', () => {
  vi.useFakeTimers();
  const [first, second] = blockIds();
  highlightChangedBlocks(editor, [first], 1000);
  vi.advanceTimersByTime(500);
  highlightChangedBlocks(editor, [second], 1000);
  vi.advanceTimersByTime(500); // first call's timer fires now; must not clear second's highlight
  expect(editor.view.dom.querySelector('.vdoc-agent-highlight')?.textContent).toBe('second');
  vi.advanceTimersByTime(500); // second call's own timer
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight')).toHaveLength(0);
});

it('ignores unknown block IDs without throwing or changing the document', () => {
  const before = editor.getJSON();
  expect(() => highlightChangedBlocks(editor, ['missing-id'])).not.toThrow();
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight')).toHaveLength(0);
  expect(editor.getJSON()).toEqual(before);
});

it('sets a presence marker on one block at a time and clears it', () => {
  const [first, second] = blockIds();
  setAgentPresence(editor, first);
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent).toBe('first');
  setAgentPresence(editor, second);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-presence')).toHaveLength(1);
  expect(editor.view.dom.querySelector('.vdoc-agent-presence')?.textContent).toBe('second');
  setAgentPresence(editor, null);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-presence')).toHaveLength(0);
});

it('clearAgentActivity removes both the highlight and the presence marker', () => {
  const [first] = blockIds();
  highlightChangedBlocks(editor, [first]);
  setAgentPresence(editor, first);
  clearAgentActivity(editor);
  expect(editor.view.dom.querySelectorAll('.vdoc-agent-highlight, .vdoc-agent-presence')).toHaveLength(0);
});

it('does nothing on a destroyed editor', () => {
  const [first] = blockIds();
  editor.destroy();
  expect(() => { highlightChangedBlocks(editor, [first]); setAgentPresence(editor, first); clearAgentActivity(editor); }).not.toThrow();
});
