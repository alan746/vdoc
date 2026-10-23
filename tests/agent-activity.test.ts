import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { attachAgentActivity, findBlockRange, type AgentActivity } from '../lib/editor/realtime/agent-activity';

// The editor is built from the production extension set only: the activity
// plugins must work when registered at runtime, as the app does.
let editor: Editor, activity: AgentActivity;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>first</p><p>second</p><p>third</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  activity = attachAgentActivity(editor, { highlightMs: 1500 });
});
afterEach(() => { activity.dispose(); editor.destroy(); vi.useRealTimers(); });
const blockIds = () => { const ids: string[] = []; editor.state.doc.descendants(node => { if (node.attrs.blockId && node.isTextblock) ids.push(node.attrs.blockId); }); return ids; };
const highlighted = () => [...editor.view.dom.querySelectorAll('.vdoc-agent-highlight')].map(node => node.textContent);
const present = () => [...editor.view.dom.querySelectorAll('.vdoc-agent-presence')].map(node => node.textContent);

it('registers its plugins at runtime on an editor built without them', () => {
  const [first] = blockIds();
  activity.highlight([first]);
  expect(highlighted()).toEqual(['first']);
});

it('highlights the changed blocks and clears itself after the duration, without touching the document', () => {
  vi.useFakeTimers();
  const before = editor.getJSON();
  const [first, , third] = blockIds();
  activity.highlight([first, third]);
  expect(highlighted()).toEqual(['first', 'third']);
  vi.advanceTimersByTime(1500);
  expect(highlighted()).toEqual([]);
  expect(editor.getJSON()).toEqual(before);
});

it('maps the highlight through a later edit instead of losing it', () => {
  vi.useFakeTimers();
  const [, second] = blockIds();
  activity.highlight([second]);
  editor.commands.insertContentAt(0, 'X');
  expect(highlighted()).toEqual(['second']);
});

it('restarts the clear timer for a newer highlight instead of letting the old timer clear it', () => {
  vi.useFakeTimers();
  const [first, second] = blockIds();
  activity.highlight([first]);
  vi.advanceTimersByTime(1000);
  activity.highlight([second]);
  vi.advanceTimersByTime(1000);
  expect(highlighted()).toEqual(['second']);
  vi.advanceTimersByTime(500);
  expect(highlighted()).toEqual([]);
});

it('ignores unknown block IDs without dispatching anything', () => {
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  activity.highlight(['missing-id']);
  activity.setPresence('missing-id');
  expect(dispatch).not.toHaveBeenCalled();
});

it('does not dispatch a transaction to clear decorations that are already empty', () => {
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  activity.clear();
  activity.setPresence(null);
  expect(dispatch).not.toHaveBeenCalled();
});

it('keeps one presence marker, moves it, and clears it', () => {
  const [first, second] = blockIds();
  activity.setPresence(first);
  expect(present()).toEqual(['first']);
  activity.setPresence(second);
  expect(present()).toEqual(['second']);
  activity.setPresence(null);
  expect(present()).toEqual([]);
});

it('clear() removes the highlight, the presence marker and the pending timer in one transaction', () => {
  vi.useFakeTimers();
  const [first] = blockIds();
  activity.highlight([first]); activity.setPresence(first);
  const dispatch = vi.spyOn(editor.view, 'dispatch');
  activity.clear();
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(highlighted()).toEqual([]); expect(present()).toEqual([]);
  vi.advanceTimersByTime(5000);
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it('dispose() unregisters the plugins, removes decorations and makes the handle inert', () => {
  vi.useFakeTimers();
  const [first] = blockIds();
  const pluginCount = editor.state.plugins.length;
  activity.highlight([first]); activity.setPresence(first);
  activity.dispose();
  expect(editor.state.plugins).toHaveLength(pluginCount - 2);
  expect(highlighted()).toEqual([]); expect(present()).toEqual([]);
  expect(() => { activity.highlight([first]); vi.advanceTimersByTime(5000); }).not.toThrow();
  expect(highlighted()).toEqual([]);
});

it('two attachments on one editor stay independent when one is disposed', () => {
  const [first, second] = blockIds();
  const other = attachAgentActivity(editor);
  other.setPresence(second);
  activity.setPresence(first);
  activity.dispose();
  expect(present()).toEqual(['second']);
  other.dispose();
});

it('is safe on a destroyed editor', () => {
  const [first] = blockIds();
  editor.destroy();
  expect(() => { activity.highlight([first]); activity.setPresence(first); activity.clear(); activity.dispose(); }).not.toThrow();
  expect(() => attachAgentActivity(editor).dispose()).not.toThrow();
});

it('findBlockRange returns the node range or undefined', () => {
  const [second] = blockIds().slice(1);
  const range = findBlockRange(editor.state.doc, second)!;
  expect(editor.state.doc.nodeAt(range.from)?.attrs.blockId).toBe(second);
  expect(range.to - range.from).toBe(editor.state.doc.nodeAt(range.from)!.nodeSize);
  expect(findBlockRange(editor.state.doc, 'missing')).toBeUndefined();
});
