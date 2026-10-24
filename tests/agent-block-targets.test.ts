import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { createRealtimeExecutor } from '../lib/usecases/realtime-executor';

// Failures seen in the voice scenario eval: block moves and deletes sent with a
// placeholder range 0..0 target were refused as TARGET; a page break "before
// the conclusion" replaced the conclusion's heading; "remove all borders" on a
// table changed one cell; the paragraph rewritten after an inserted table
// landed in its last cell; the agent could not undo its own edit mid-turn.

let editor: Editor, engine: DocumentEngine;
const origin = { actor: 'agent-1', turnId: 'turn-1' };
const setup = async (content: string) => {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
};
afterEach(() => { engine.destroy(); editor.destroy(); });
const version = () => { const s = engine.snapshot(); return { expectedSessionId: s.sessionId, expectedRevision: s.revision }; };
const blockAt = (text: string) => engine.snapshot().blocks.find(block => block.text === text)!;
const texts = () => engine.snapshot().blocks.map(block => block.text).filter(Boolean);
const types = () => (editor.getJSON().content ?? []).map(node => node.type);
const tableId = () => (editor.getJSON().content ?? []).find(node => node.type === 'table')!.attrs!.blockId as string;
const cells = () => (editor.getJSON().content ?? []).find(node => node.type === 'table')!.content!.flatMap(row => (row as JSONContent).content ?? []);
const placeholder = { kind: 'range', from: 0, to: 0 } as const;

describe('block operations ignore a placeholder target', () => {
  it('moves blocks by ID with a range 0..0 target', async () => {
    await setup('<h2>运球</h2><h2>投篮</h2><h2>团队配合</h2>');
    const result = engine.executeAgent({ ...version(), target: placeholder, operations: [{ type: 'block.move', id: blockAt('团队配合').id, position: { anchorId: blockAt('运球').id, relation: 'after' } }] }, origin);
    expect(result.ok).toBe(true);
    expect(texts()).toEqual(['运球', '团队配合', '投篮']);
  });

  it('deletes blocks by ID with a range 0..0 target', async () => {
    await setup('<h2>安装</h2><h2>License</h2><p>MIT</p>');
    const result = engine.executeAgent({ ...version(), target: placeholder, operations: [{ type: 'block.delete', id: blockAt('License').id }, { type: 'block.delete', id: blockAt('MIT').id }] }, origin);
    expect(result.ok).toBe(true);
    expect(texts()).toEqual(['安装']);
  });

  it('still refuses a placeholder target when a batch also edits through it', async () => {
    await setup('<p>第一段</p><p>第二段</p>');
    const result = engine.executeAgent({ ...version(), target: placeholder, operations: [{ type: 'block.delete', id: blockAt('第一段').id }, { type: 'text.toggle', mark: 'bold' }] }, origin);
    expect(result).toMatchObject({ ok: false, code: 'TARGET' });
    expect(texts()).toEqual(['第一段', '第二段']);
  });
});

describe('page breaks and tables of contents keep the targeted block', () => {
  it('puts a page break before the targeted heading', async () => {
    await setup('<h2>四、讨论</h2><p>讨论正文</p><h2>五、结论</h2><p>结论正文</p>');
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: blockAt('五、结论').id }, operations: [{ type: 'block.pageBreak' }] }, origin);
    expect(result.ok).toBe(true);
    expect(types()).toEqual(['heading', 'paragraph', 'pageBreak', 'heading', 'paragraph']);
    expect(texts()).toContain('五、结论');
  });

  it('puts a table of contents before the targeted paragraph', async () => {
    await setup('<h1>报告</h1><p>正文</p>');
    expect(engine.executeAgent({ ...version(), target: { kind: 'block', id: blockAt('正文').id }, operations: [{ type: 'block.toc' }] }, origin).ok).toBe(true);
    expect(types()).toEqual(['heading', 'tableOfContents', 'paragraph']);
    expect(texts()).toContain('正文');
  });

  it('still inserts a page break at a cursor', async () => {
    await setup('<p>前半</p><p>后半</p>');
    const later = blockAt('后半');
    expect(engine.executeAgent({ ...version(), target: { kind: 'text', blockId: later.id, start: 0, end: 0 }, operations: [{ type: 'block.pageBreak' }] }, origin).ok).toBe(true);
    expect(types()).toContain('pageBreak');
    expect(texts()).toEqual(expect.arrayContaining(['前半', '后半']));
  });
});

describe('a whole-table target', () => {
  it('sets borders on every cell', async () => {
    await setup('<table><tr><th>商品</th><th>价格</th></tr><tr><td>苹果</td><td>5元</td></tr><tr><td>香蕉</td><td>3元</td></tr></table>');
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: tableId() }, operations: [{ type: 'table.border', scope: 'all', color: '#000000', width: 0, style: 'solid' }] }, origin);
    expect(result.ok).toBe(true);
    const all = cells();
    expect(all).toHaveLength(6);
    for (const cell of all) expect(JSON.stringify(cell.attrs?.borders)).toContain('"width":0');
  });
});

describe('a batch that inserts a table and then rewrites the paragraph it came from', () => {
  it('rewrites the original paragraph, not the new table', async () => {
    await setup('<h2>四、预算</h2><p>场地40万元，设备30万元，宣传50万元，合计120万元。所有支出需提前审批。</p><h2>五、风险</h2>');
    const source = blockAt('场地40万元，设备30万元，宣传50万元，合计120万元。所有支出需提前审批。');
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: source.id }, operations: [
      { type: 'block.insert', position: { anchorId: source.id, relation: 'before' }, block: { kind: 'table', rows: 3, cols: 2, header: true, headerText: ['项目', '金额'], rowsText: [['场地', '40万元'], ['合计', '120万元']] } },
      { type: 'text.replace', text: '所有支出需提前审批。' },
    ] }, origin);
    expect(result.ok).toBe(true);
    expect(texts()).toContain('所有支出需提前审批。');
    expect(texts()).toContain('120万元');
  });
});

describe('a table with header text repeated in rowsText', () => {
  it('explains that rowsText holds data rows only', async () => {
    await setup('<p>联系人</p>');
    const anchor = blockAt('联系人');
    const result = engine.executeAgent({ ...version(), target: { kind: 'block', id: anchor.id }, operations: [{ type: 'block.insert', position: { anchorId: anchor.id, relation: 'after' }, block: { kind: 'table', rows: 3, cols: 2, header: true, headerText: ['姓名', '部门'], rowsText: [['姓名', '部门'], ['张三', '人事部'], ['李四', 'IT支持']] } }] }, origin);
    expect(result).toMatchObject({ ok: false, code: 'INVALID' });
    expect(result.error).toContain('at most 2');
    expect(result.error).toContain('headerText');
  });
});

describe('undoing an edit made earlier in the same turn', () => {
  it('lets the agent take back its own change before the turn ends', async () => {
    await setup('<p>原文</p>');
    const lifetime = new AbortController(), call = new AbortController();
    const executor = createRealtimeExecutor(engine, { docId: 'doc-1', actor: 'trusted-agent', signal: lifetime.signal, currentDocument: () => ({ docId: 'doc-1', sessionId: engine.sessionId }) });
    const context = (callId: string) => ({ callId, turnId: 'turn-1', epoch: 1, signal: call.signal });
    const block = blockAt('原文');
    expect((await executor.apply({ ...version(), target: { kind: 'text', blockId: block.id, start: 0, end: 2 }, operations: [{ type: 'text.replace', text: '改坏了' }] }, context('call-1'))).ok).toBe(true);
    const undo = await executor.undo({ targetTurnId: 'turn-1', ...version() }, context('call-2'));
    expect(undo.ok).toBe(true);
    expect(texts()).toEqual(['原文']);
    lifetime.abort();
  });
});
