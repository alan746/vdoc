import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import {colorToHex} from '../lib/domain/text/color';
import { copyTextFormat, canPasteTextFormat } from '../lib/editor/format/format-copy';
import type { TextFormat } from '../lib/domain/rules/text-format';
import {parseDocument} from '../lib/infrastructure/persistence/document-codec';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine,clipboard:TextFormat|null;
const format:TextFormat={bold:true,italic:false,underline:true,strike:false,color:'#CC2233',highlight:'#FFFF00',fontFamily:'Georgia',fontSize:23.5,script:'superscript'};
const plain:TextFormat={bold:false,italic:false,underline:false,strike:false,color:null,highlight:null,fontFamily:null,fontSize:null,script:'normal'};
beforeEach(async()=>{clipboard=null;editor=new Editor({extensions:createExtensions(op=>op==='undo'||op==='redo'?engine.history(op).ok:engine.execute({source:'keyboard',operations:[op]}).ok,undefined,action=>{if(action==='copy'){clipboard=copyTextFormat(editor);return !!clipboard;}return !!clipboard&&engine.execute({operations:[{type:'format.apply',format:clipboard}]}).ok;}),content:'<p><strong><u><span style="font-family:Georgia;font-size:23.5px;color:#cc2233"><mark data-color="#ffff00" style="background-color:#ffff00"><sup>Source 中文</sup></mark></span></u></strong></p><p><em><s>Target 日本語</s></em></p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function pos(text:string){let p=-1;editor.state.doc.descendants((n,i)=>{if(n.isText&&n.text===text)p=i;});if(p<0)throw new Error(text);return p;}
function select(text:string,caret=false){const p=pos(text);editor.commands.setTextSelection({from:p,to:caret?p:p+text.length});}
const run=(f=format)=>engine.execute({operations:[{type:'format.apply',format:f}]});
function cells(){let p=-1;editor.state.doc.descendants((n,i)=>{if(n.type.name==='table'&&p<0)p=i;});const m=TableMap.get(editor.state.doc.nodeAt(p)!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,p+1+m.map.at(-1)!,p+1+m.map[0])));}
it('copies supported character attributes without changing content, selection, revision or history',()=>{
 select('Source 中文');const before=editor.getJSON(),s=editor.state.selection.toJSON(),revision=engine.revision;expect(copyTextFormat(editor)).toEqual(format);expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(s);expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(0);
});
it('replaces target styles rather than stacking them, preserving text and exact undo/redo',()=>{
 select('Target 日本語');const before=editor.getJSON(),ids=engine.snapshot().blocks.map(b=>b.id),text=editor.state.doc.textContent;expect(run().ok).toBe(true);expect(copyTextFormat(editor)).toEqual(format);expect(editor.state.doc.textContent).toBe(text);expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it('plain formatting clears font, color, highlight and script without removing links',()=>{
 editor.commands.setContent('<p><a href="https://example.com"><strong><sup><span style="font-family:Georgia;font-size:24px;color:#ff0000"><mark data-color="#ffff00">Linked</mark></span></sup></strong></a></p>');select('Linked');expect(run(plain).ok).toBe(true);expect(editor.state.doc.firstChild!.firstChild!.marks.map(m=>m.type.name)).toEqual(['formatOverride','link']);expect(copyTextFormat(editor)).toMatchObject({bold:false,underline:false});expect(editor.state.doc.firstChild!.firstChild!.marks.find(m=>m.type.name==='link')!.attrs.href).toBe('https://example.com');
});
it('repeating the same format is a no-op with no extra revision or undo step',()=>{
 select('Target 日本語');const before=editor.getJSON();run();const rev=engine.revision;expect(run().ok).toBe(true);expect(engine.revision).toBe(rev);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('applies to a reverse multi-paragraph range while preserving paragraph layouts and headings',()=>{
 editor.commands.setContent('<h2 dir="rtl" data-indent-start="36">العربية</h2><p style="text-align:center">中文</p>');editor.commands.setTextSelection({from:pos('中文')+2,to:pos('العربية')});const attrs=editor.state.doc.content.content.map(n=>[n.type.name,n.attrs]);expect(run().ok).toBe(true);expect(editor.state.doc.content.content.map(n=>[n.type.name,n.attrs])).toEqual(attrs);expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);
});
it('formats only selected fragments and retains surrounding marks',()=>{
 select('Target 日本語');const p=pos('Target 日本語');editor.commands.setTextSelection({from:p+1,to:p+4});expect(run().ok).toBe(true);const parts=editor.state.doc.child(1).content.content;expect(parts.map(n=>n.text)).toEqual(['T','arg','et 日本語']);expect(parts[0].marks.some(m=>m.type.name==='italic')).toBe(true);expect(parts[1].marks.some(m=>m.type.name==='italic')).toBe(false);expect(parts[2].marks.some(m=>m.type.name==='strike')).toBe(true);
});
it('formats reverse merged-cell selections without changing geometry or objects',()=>{
 editor.commands.setContent('<table><tr><th colspan="2"><p>A</p><img src="data:image/png;base64,AA==" alt="Keep"/></th><td rowspan="2"><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>');cells();const grid=engine.snapshot().tables;let imageBefore:Record<string,unknown>|undefined;editor.state.doc.descendants(n=>{if(n.type.name==='image')imageBefore=n.toJSON();});expect(run().ok).toBe(true);expect(engine.snapshot().tables).toEqual(grid);editor.state.doc.descendants(n=>{if(n.type.name==='image')expect(n.toJSON()).toEqual(imageBefore);});expect((editor.state.selection as CellSelection).$anchorCell.pos).toBeGreaterThan((editor.state.selection as CellSelection).$headCell.pos);
});
it('skips code text and rejects empty or code-only targets',()=>{
 editor.commands.setContent('<p><code>Code</code>Normal</p><pre><code>Block</code></pre>');select('Code');expect(canPasteTextFormat(editor)).toBe(false);expect(run().ok).toBe(false);expect(copyTextFormat(editor)).toBeNull();editor.commands.selectAll();expect(run().ok).toBe(true);expect(editor.state.doc.firstChild!.firstChild!.marks.map(m=>m.type.name)).toEqual(['code']);expect(editor.state.doc.child(1).firstChild!.marks).toEqual([]);select('Normal',true);expect(canPasteTextFormat(editor)).toBe(false);expect(run().ok).toBe(false);
});
it('takes the style at the selection start, including a backward selection',()=>{
 editor.commands.setContent('<p><strong>Bold</strong><em>Italic</em></p>');editor.commands.setTextSelection({from:pos('Italic')+6,to:pos('Bold')});expect(copyTextFormat(editor)).toMatchObject({bold:true,italic:false});
});
it('uses pending caret marks when formatting has been turned off before typing',()=>{
 select('Source 中文',true);editor.view.dispatch(editor.state.tr.setStoredMarks([]));expect(copyTextFormat(editor)).toMatchObject({bold:false,underline:false,highlight:null,script:'normal',fontFamily:null,fontSize:null});
});
it('keeps atomic batches and rejects invalid format values',()=>{
 select('Target 日本語');const before=editor.getJSON();expect(engine.execute({operations:[{type:'format.apply',format},{type:'list.indent',direction:'in'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);for(const patch of [{fontSize:401},{color:'url(x)'},{fontFamily:'url(x)'},{script:'code'}]){expect(engine.execute({operations:[{type:'format.apply',format:{...format,...patch}}]}).code).toBe('INVALID');expect(editor.getJSON()).toEqual(before);}
});
it('supports explicit external targets and rejects stale requests and composition',()=>{
 const s=engine.snapshot(),request={source:'api',expectedSessionId:s.sessionId,expectedRevision:s.revision,target:{kind:'block',id:s.blocks.find(b=>b.text==='Target 日本語')!.id},operations:[{type:'format.apply',format}]};expect(engine.executeExternal(request).ok).toBe(true);expect(engine.executeExternal(request).code).toBe('STALE');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(copyTextFormat(editor)).toBeNull();expect(canPasteTextFormat(editor)).toBe(false);expect(run().code).toBe('COMPOSING');
});
it('copies and pastes using keyboard commands without the system clipboard',()=>{
 const key=(key:string)=>{const e=new KeyboardEvent('keydown',{key,ctrlKey:true,altKey:true,bubbles:true,cancelable:true});editor.view.dom.dispatchEvent(e);return e.defaultPrevented;};select('Source 中文');expect(key('c')).toBe(true);select('Target 日本語');expect(key('v')).toBe(true);expect(copyTextFormat(editor)).toEqual(format);
});
it('keeps styled contents through HTML, local backup and actual DOCX bytes',async()=>{
 select('Target 日本語');run({...format,fontSize:24});const after=editor.getJSON(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});const normalized=(value:unknown)=>JSON.stringify(value,(key,val)=>key==='color'?colorToHex(val)??val:val);expect(normalized(other.getJSON())).toEqual(normalized(after));other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Formats',content:after})).content).toEqual(after);const blob=await exportWord(after,'Formats'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const result=await importWord(buffer);expect(result.warnings).toEqual([]);editor.commands.setContent(result.content);select('Target 日本語');expect(copyTextFormat(editor)).toEqual({...format,fontSize:24});
});
it('consumes paste-format without a copied format and does not modify text',()=>{
 select('Target 日本語');const before=editor.getJSON(),e=new KeyboardEvent('keydown',{key:'v',ctrlKey:true,altKey:true,bubbles:true,cancelable:true});editor.view.dom.dispatchEvent(e);expect(e.defaultPrevented).toBe(true);expect(editor.getJSON()).toEqual(before);expect(engine.records).toHaveLength(0);
});
it('keeps formatting outside selected cells untouched, including nested lists and checkbox state',()=>{
 editor.commands.setContent('<table><tr><td><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Selected</p></li></ul></td><td><p><em>Keep</em></p></td></tr></table>');const snapshot=engine.snapshot(),other=editor.state.doc.firstChild!.firstChild!.child(1).toJSON();expect(engine.execute({target:{kind:'cells',tableId:snapshot.tables[0].id,row:0,col:0},operations:[{type:'format.apply',format}]}).ok).toBe(true);expect(editor.state.doc.firstChild!.firstChild!.child(1).toJSON()).toEqual(other);expect(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.firstChild!.attrs.checked).toBe(true);expect(engine.snapshot().tables).toEqual(snapshot.tables);
});
it('does not silently replace unsupported imported font families or out-of-range sizes',()=>{
 for(const style of ['font-family:Papyrus;font-size:16px','font-family:Arial;font-size:120px']){editor.commands.setContent(`<p><span style="${style}">Imported</span></p>`);select('Imported');expect(copyTextFormat(editor)).toBeNull();}
});
it('copies the first text format after Select all, without selecting or changing anything',()=>{
 editor.commands.selectAll();const before=editor.getJSON(),selection=editor.state.selection.toJSON(),revision=engine.revision;expect(copyTextFormat(editor)).toEqual(format);expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(selection);expect(engine.revision).toBe(revision);
});
it('samples the first selected cell in document order even when anchor and head are reversed',()=>{
 editor.commands.setContent('<table><tr><th colspan="2"><p><strong><span style="color:#ff0000">First</span></strong></p></th><td rowspan="2"><p><em>Second</em></p></td></tr><tr><td><p>Third</p></td><td><p>Last</p></td></tr></table>');cells();const selection=editor.state.selection.toJSON(),grid=engine.snapshot().tables;expect(copyTextFormat(editor)).toMatchObject({bold:true,italic:false,color:'#FF0000'});expect(editor.state.selection.toJSON()).toEqual(selection);expect(engine.snapshot().tables).toEqual(grid);
});
it('does not sample unselected cells between disjoint ranges of a column',()=>{
 editor.commands.setContent('<table><tr><td><p><strong>Outside</strong></p></td><td><p><em>Selected first</em></p></td></tr><tr><td><p><u>Outside two</u></p></td><td><p>Selected second</p></td></tr></table>');const map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[3],1+map.map[1])));expect(copyTextFormat(editor)).toMatchObject({bold:false,italic:true,underline:false});
});
it('samples an empty first cell without borrowing styles or pending marks from later text',()=>{
 editor.commands.setContent('<table><tr><td><p></p></td><td><p><strong>Later</strong></p></td></tr></table>');cells();editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks.italic.create()]));expect(copyTextFormat(editor)).toMatchObject({bold:false,italic:false});
});
it('skips leading non-text objects for whole-document sources, but does not copy code-only text selections',()=>{
 editor.commands.setContent('<img src="data:image/png;base64,AA=="/><p><u>Text</u></p>');editor.commands.selectAll();expect(copyTextFormat(editor)).toMatchObject({underline:true});editor.commands.setContent('<pre><code>Code only</code></pre>');select('Code only');expect(copyTextFormat(editor)).toBeNull();
});
it('samples selected text after a paragraph boundary, not unselected text before it',()=>{
 editor.commands.setContent('<p><strong>Before</strong></p><p><em>العربية</em></p>');
 editor.commands.setTextSelection({from:pos('العربية')+3,to:pos('Before')+6});
 expect(copyTextFormat(editor)).toMatchObject({bold:false,italic:true});
});
it('ignores a leading footnote when sampling selected text',()=>{
 editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'footnote',attrs:{text:'注释'}},{type:'text',text:'हिन्दी',marks:[{type:'underline'}]}]}]});
 editor.commands.selectAll();expect(copyTextFormat(editor)).toMatchObject({underline:true,script:'normal'});
});
it('does not offer a format for a selection containing only a line break or footnote',()=>{
 editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before',marks:[{type:'bold'}]},{type:'hardBreak'},{type:'footnote',attrs:{text:'Note'}},{type:'text',text:'After',marks:[{type:'italic'}]}]}]});
 const start=pos('Before')+6;editor.commands.setTextSelection({from:start,to:start+2});expect(copyTextFormat(editor)).toBeNull();
});
it('samples only the selected run at a mark boundary, including its computed appearance',()=>{
 editor.commands.setContent('<p><strong>Before</strong><em>After</em></p>');
 const style=document.createElement('style');style.textContent='.ProseMirror strong { color:rgb(255,0,0);font-weight:700 } .ProseMirror em { color:rgb(0,128,0);font-weight:400 }';document.head.appendChild(style);
 try{select('After');expect(copyTextFormat(editor)).toMatchObject({bold:false,italic:true,color:'#008000'});}finally{style.remove();}
});
it.each([['12pt',16],['1pc',16],['0.25in',24],['0.635cm',24],['6.35mm',24],['24px',24]])('converts imported absolute font size %s to pixels without changing its visual size',(size,expected)=>{
 editor.commands.setContent(`<p><span style="font-size:${size}">Imported</span></p><p>Target</p>`);select('Imported');const copied=copyTextFormat(editor);expect(copied?.fontSize).toBeCloseTo(expected);
 select('Target');expect(run(copied!).ok).toBe(true);expect(editor.state.doc.child(1).firstChild!.marks.find(m=>m.type.name==='textStyle')?.attrs.fontSize).toBe(`${expected}px`);
});
it('rejects font units it cannot resolve instead of interpreting the numeric prefix as pixels',()=>{
 editor.commands.setContent('<p><span style="font-size:12em">Relative</span></p>');select('Relative');expect(copyTextFormat(editor)).toBeNull();
});
