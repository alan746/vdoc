import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

// Failures seen in the voice scenario eval: one text.replace over a range that
// spans paragraphs emptied a whole section and pulled the paragraph after a
// table into its last cell; deleting a list item was refused as "unavailable";
// a confirmed find/replace failed on a stale target.

let editor: Editor, engine: DocumentEngine;
const origin = { actor: 'agent-1', turnId: 'turn-1' };
const setup = async (content: string) => {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
};
afterEach(() => { engine.destroy(); editor.destroy(); vi.restoreAllMocks(); });
const version = () => { const s = engine.snapshot(); return { expectedSessionId: s.sessionId, expectedRevision: s.revision }; };
const blockAt = (text: string) => engine.snapshot().blocks.find(block => block.text === text)!;
const texts = () => engine.snapshot().blocks.map(block => block.text);

describe('agent text edits stay inside one block', () => {
  beforeEach(() => setup('<h2>背景</h2><p>第一段</p><p>第二段</p><h2>目标</h2>'));

  it('refuses a replacement that spans paragraphs and leaves the document unchanged', () => {
    const first = blockAt('第一段'), second = blockAt('第二段'), before = texts();
    const result = engine.executeAgent({ ...version(), target: { kind: 'range', from: first.from, to: second.to }, operations: [{ type: 'text.replace', text: '' }] }, origin);
    expect(result).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(result.error).toContain('block.delete');
    expect(texts()).toEqual(before);
  });

  it('refuses a deletion that spans paragraphs', () => {
    const first = blockAt('第一段'), second = blockAt('第二段');
    expect(engine.executeAgent({ ...version(), target: { kind: 'range', from: first.from, to: second.to }, operations: [{ type: 'text.delete' }] }, origin).ok).toBe(false);
    expect(texts()).toContain('第一段');
  });

  it('still replaces text inside one paragraph', () => {
    const second = blockAt('第二段');
    expect(engine.executeAgent({ ...version(), target: { kind: 'text', blockId: second.id, start: 0, end: 3 }, operations: [{ type: 'text.replace', text: '改写后' }] }, origin).ok).toBe(true);
    expect(texts()).toContain('改写后');
  });

  it('keeps the paragraph after a table out of its last cell', async () => {
    engine.destroy(); editor.destroy();
    await setup('<table><tr><th>项目</th><th>金额</th></tr><tr><td>合计</td><td>80万元</td></tr></table><p>各项支出将按周跟踪。</p>');
    const cell = blockAt('80万元'), after = blockAt('各项支出将按周跟踪。');
    expect(engine.executeAgent({ ...version(), target: { kind: 'range', from: cell.from, to: after.from + 2 }, operations: [{ type: 'text.replace', text: '' }] }, origin).ok).toBe(false);
    expect(blockAt('80万元')).toBeDefined();
    expect(blockAt('各项支出将按周跟踪。')).toBeDefined();
  });
});

describe('block.delete on list items', () => {
  beforeEach(() => setup('<p>明年计划</p><ol><li><p>第一条</p></li><li><p>第二条</p></li><li><p>第三条</p></li></ol><p>结尾</p>'));

  it('deletes only the named item', () => {
    expect(engine.executeAgent({ ...version(), target: { kind: 'block', id: blockAt('第二条').id }, operations: [{ type: 'block.delete', id: blockAt('第二条').id }] }, origin).ok).toBe(true);
    expect(texts()).toEqual(['明年计划', '第一条', '第三条', '结尾']);
    expect(editor.getJSON().content?.filter(node => node.type === 'orderedList')).toHaveLength(1);
  });

  it('removes the list with its only item', async () => {
    engine.destroy(); editor.destroy();
    await setup('<p>前</p><ul><li><p>唯一</p></li></ul><p>后</p>');
    expect(engine.executeAgent({ ...version(), target: { kind: 'block', id: blockAt('唯一').id }, operations: [{ type: 'block.delete', id: blockAt('唯一').id }] }, origin).ok).toBe(true);
    expect(editor.getJSON().content?.map(node => node.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('explains a block it cannot delete', () => {
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: blockAt('结尾').id }, operations: [{ type: 'block.delete', id: 'missing-block' }] }, origin);
    expect(result).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(result.error).toContain('Read the document again');
  });
});

describe('find and replace', () => {
  beforeEach(() => setup('<p>本次发布会希望达成三项目标。</p><p>发布会定于下午两点开始。</p>'));

  it('replaces every match even when the target has gone stale', () => {
    const stale = engine.snapshot().blocks[0];
    engine.execute({ ...version(), target: { kind: 'block', id: stale.id }, operations: [{ type: 'block.delete', id: stale.id }] });
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: stale.id }, operations: [{ type: 'text.findReplace', query: '发布会', replacement: '新品发布会', caseSensitive: false, wholeWord: false }] }, origin);
    expect(result.ok).toBe(true);
    expect(texts()[0]).toBe('新品发布会定于下午两点开始。');
  });

  it('says when nothing matches', () => {
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: engine.snapshot().blocks[0].id }, operations: [{ type: 'text.findReplace', query: '星河科技', replacement: '北辰科技', caseSensitive: false, wholeWord: false }] }, origin);
    expect(result).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(result.error).toContain('No text matches "星河科技"');
  });

  it('still refuses a stale target for edits that are not document-wide', () => {
    const stale = engine.snapshot().blocks[0];
    engine.execute({ ...version(), target: { kind: 'block', id: stale.id }, operations: [{ type: 'block.delete', id: stale.id }] });
    expect(engine.executeAgent({ ...version(), target: { kind: 'block', id: stale.id }, operations: [{ type: 'text.toggle', mark: 'bold' }] }, origin)).toMatchObject({ ok: false, code: 'TARGET' });
  });
});
