import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { continuedStart, numberedListContext } from '../lib/editor/list-numbering';
import { parseDocument } from '../lib/editor/storage';
import { exportWord, importWord } from '../lib/editor/word';
import { exportHTML } from '../lib/editor/html-export';
import { previewSource } from '../lib/editor/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
const list = (items: string[], start = 1, linked = false) => `<ol start="${start}"${linked ? ' data-continue-numbering="true"' : ''}>${items.map(text => `<li><p>${text}</p></li>`).join('')}</ol>`;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: list(['A', 'B', 'C'], 4) + '<p>Gap</p>' + list(['D', 'E']) });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
function position(text: string) { let found = -1; editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) found = pos; }); if (found < 0) throw new Error(`Missing ${text}`); return found; }
const select = (text: string) => editor.commands.setTextSelection(position(text));
const lists = () => { const values: {start: number; linked: boolean; text: string}[] = []; editor.state.doc.descendants(node => { if (node.type.name === 'orderedList') values.push({ start: node.attrs.start, linked: node.attrs.continuePrevious, text: node.textContent }); }); return values; };
const run = (operation: unknown) => engine.execute({ operations: [operation] });
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
it('restarts at the current item while preserving preceding items, IDs, marks and caret; one undo restores everything', () => {
  select('B'); run({type: 'text.toggle', mark: 'bold'}); run({type: 'text.insert', text: 'β'}); editor.commands.setTextSelection(position('B'));
  const before = editor.getJSON(), ids = engine.snapshot().blocks.map(b => b.id);
  expect(run({ type: 'list.restart', start: 9 }).ok).toBe(true);
  expect(lists()).toEqual([{start:4,linked:false,text:'A'}, {start:9,linked:false,text:'βBC'}, {start:1,linked:false,text:'DE'}]);
  expect(editor.state.selection.$from.parent.textContent).toBe('βB'); expect(engine.snapshot().blocks.map(b => b.id)).toEqual(ids);
  const after = editor.getJSON(); engine.history('undo'); expect(editor.getJSON()).toEqual(before); engine.history('redo'); expect(editor.getJSON()).toEqual(after);
});
it('links separated lists and updates following chains after Enter, deletion and undo', () => {
  select('D'); expect(run({type:'list.continue'}).ok).toBe(true); expect(lists()[1]).toMatchObject({start:7,linked:true});
  const before = editor.getJSON(); editor.commands.setTextSelection(position('C') + 1); editor.commands.splitListItem('listItem');
  expect(lists()[1].start).toBe(8); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  editor.commands.setTextSelection({from:position('B'),to:position('C') + 1}); editor.commands.deleteSelection(); expect(lists()[1].start).toBe(6);
});
it('continuation from a middle item creates a linked tail that tracks its prefix', () => {
  select('B'); expect(run({type:'list.continue'}).ok).toBe(true); expect(lists().slice(0,2)).toEqual([{start:4,linked:false,text:'A'}, {start:5,linked:true,text:'BC'}]);
  select('A'); run({type:'list.restart',start:20}); expect(lists()[1].start).toBe(21);
});
it('restarting a continued list detaches it; unchanged independent starts do not change revision', () => {
  select('D'); run({type:'list.continue'}); run({type:'list.restart',start:7}); expect(lists()[1].linked).toBe(false);
  const revision = engine.revision; run({type:'list.restart',start:7}); expect(engine.revision).toBe(revision);
  select('A'); run({type:'list.restart',start:20}); expect(lists()[1].start).toBe(7);
});
it('counts direct items only and isolates nested lists and bullet descendants', () => {
  editor.commands.setContent('<ol start="4"><li><p>A</p>'+list(['inner1','inner2'],8)+'<p>Inside gap</p>'+list(['inner3'])+'</li><li><p>B</p><ul><li><p>Bullet</p></li></ul></li></ol><p>Gap</p>'+list(['D']));
  select('inner3'); run({type:'list.continue'}); expect(lists()[2]).toMatchObject({start:10,linked:true});
  select('D'); run({type:'list.continue'}); expect(lists()[3]).toMatchObject({start:6,linked:true});
  select('Bullet'); expect(run({type:'list.restart',start:9}).ok).toBe(false);
});
it('restarts selected cells independently while preserving links and rejecting cross-list text selections', () => {
  editor.commands.setContent('<table><tr><td>'+list(['A'],8)+'</td><td>'+list(['B'])+'<p>Gap</p>'+list(['C'])+'</td></tr></table>');
  select('B'); expect(continuedStart(numberedListContext(editor.state.doc,editor.state.selection)!)).toBeNull(); expect(run({type:'list.continue'}).ok).toBe(false);
  select('C'); expect(run({type:'list.continue'}).ok).toBe(true); expect(lists()[2].start).toBe(2);
  const map = TableMap.get(editor.state.doc.firstChild!); editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0],1+map.map[1])));
  const before=editor.getJSON(); expect(run({type:'list.restart',start:10}).ok).toBe(true);expect(lists().map(n=>[n.start,n.linked])).toEqual([[10,false],[10,false],[11,true]]);engine.history('undo');expect(editor.getJSON()).toEqual(before);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,position('B'),position('C')+1)));
  expect(run({type:'list.restart',start:10}).ok).toBe(false);
});
it('rejects unavailable continuation atomically with preceding writes', () => {
  select('A'); const before=editor.getJSON(); expect(engine.execute({operations:[{type:'text.insert',text:'No write'}, {type:'list.continue'}]}).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it.each([-1, 1.2, 2147483648, '3', null])('rejects invalid start %s in both operations and backups', start => {
  const before=editor.getJSON(); expect(run({type:'list.restart',start}).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  const backup=structuredClone(before); backup.content![0].attrs!.start=start; expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content:backup}))).toThrow('list start');
});
it('retains start zero and continuation in HTML, backups and preview source', () => {
  select('A'); run({type:'list.restart',start:0}); select('D'); run({type:'list.continue'}); const before=editor.getJSON();
  expect(lists()[1].start).toBe(3); const other=new Editor({extensions:createExtensions(),content:editor.getHTML()}); expect(other.getJSON()).toEqual(before); other.destroy();
  expect(parseDocument(JSON.stringify({version:1,title:'Numbering',content:before})).content).toEqual(before);
  const preview=new DOMParser().parseFromString(previewSource('Lists',editor.getHTML(),before).html,'text/html'); expect([...preview.querySelectorAll('ol')].map(el=>el.start)).toEqual([0,3]);
  expect(exportHTML('Lists',editor.getHTML(),before)).toContain('data-continue-numbering="true"');
});
it('round-trips separated continued lists through actual DOCX and retains the shared Word numbering ID', async () => {
  select('A'); run({type:'list.restart',start:0}); select('D'); run({type:'list.continue'});
  const buffer=await bytes(await exportWord(editor.getJSON(),'Lists')); const zip=await JSZip.loadAsync(buffer);
  const xml=await zip.file('word/document.xml')!.async('string'); expect(new Set([...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map(m=>m[1])).size).toBe(1);
  const result=await importWord(buffer); expect(result.warnings).toEqual([]); editor.commands.setContent(result.content);
  expect(lists()).toEqual([{start:0,linked:false,text:'ABC'},{start:3,linked:true,text:'DE'}]);
});
it('retains an adjacent mid-list restart across Word conversion, including multilingual text', async () => {
  editor.commands.setContent(list(['中文','العربية','हिन्दी'],4)); select('العربية'); run({type:'list.restart',start:12});
  const result=await importWord(await bytes(await exportWord(editor.getJSON(),'Restart'))); editor.commands.setContent(result.content);
  expect(lists()).toEqual([{start:4,linked:false,text:'中文'},{start:12,linked:false,text:'العربيةहिन्दी'}]);
});
it('round-trips nested continued lists and independent table cell counters through Word', async () => {
  editor.commands.setContent('<ol start="2"><li><p>Outer</p>'+list(['Nested A','Nested B'],8)+'<p>Nested gap</p>'+list(['Nested C'],10,true)+'</li><li><p>Outer end</p></li></ol><table><tr><td>'+list(['Cell A'],20)+'</td><td>'+list(['Cell B'],1)+'<p>Cell gap</p>'+list(['Cell C'],2,true)+'</td></tr></table>');
  const result=await importWord(await bytes(await exportWord(editor.getJSON(),'Nested'))); editor.commands.setContent(result.content);
  expect(lists().map(({start,linked})=>({start,linked}))).toEqual([{start:2,linked:false},{start:8,linked:false},{start:10,linked:true},{start:20,linked:false},{start:1,linked:false},{start:2,linked:true}]);
  expect(editor.state.doc.firstChild!.childCount).toBe(2); expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(4);
});
it.each(['ol','ul'])('does not create extra Word numbers for multiple paragraphs and headings in one %s item', async tag => {
  editor.commands.setContent(`<${tag}><li><p>First</p><p data-tab-interval="72" data-indent-start="12"><strong>中文\tSecond</strong></p><h2>Item heading</h2></li><li><p>Next item</p></li></${tag}>`);
  const buffer=await bytes(await exportWord(editor.getJSON(),'Multiple paragraphs'));
  const zip=await JSZip.loadAsync(buffer), xml=await zip.file('word/document.xml')!.async('string');
  expect((xml.match(/<w:numPr>/g)||[]).length).toBe(2);
  const result=await importWord(buffer); expect(result.warnings).toEqual([]); editor.commands.setContent(result.content);
  const root=editor.state.doc.firstChild!; expect(root.type.name).toBe(tag==='ol'?'orderedList':'bulletList'); expect(root.childCount).toBe(2);
  const item=root.firstChild!; expect(item.childCount).toBe(3); expect(item.child(1).textContent).toBe('中文\tSecond');
  expect(item.child(1).attrs).toMatchObject({tabInterval:72,indentStart:12}); expect(item.child(1).firstChild!.marks.some(mark=>mark.type.name==='bold')).toBe(true);
  expect(item.child(2).type.name).toBe('heading'); expect(item.child(2).attrs.level).toBe(2);
});
it('preserves selection bookmarks and rejects stale external numbering requests', () => {
  select('D'); engine.captureSelection(); editor.commands.setTextSelection(position('A'));
  // A new real selection invalidates the old bookmark; it cannot silently number D.
  expect(run({type:'list.continue'}).ok).toBe(false);
  const snapshot=engine.snapshot(); const target=snapshot.blocks.find(block=>block.text==='D')!;
  const request={source:'api',expectedSessionId:snapshot.sessionId,expectedRevision:snapshot.revision,target:{kind:'block',id:target.id},operations:[{type:'list.continue'}]};
  expect(engine.execute(request).ok).toBe(true); const before=editor.getJSON(); expect(engine.execute(request).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it('recomputes an entire continuation chain while a restart remains independent', () => {
  editor.commands.setContent(list(['A','B'],4)+'<p>Gap</p>'+list(['C'],6,true)+'<p>Gap</p>'+list(['D'],7,true)+'<p>Gap</p>'+list(['E'],10));
  select('A'); const before=editor.getJSON(); run({type:'list.restart',start:0}); expect(lists().map(n=>n.start)).toEqual([0,2,3,10]); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
