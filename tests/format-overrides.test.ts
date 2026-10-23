import {writeFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import {effectiveFormatActive} from '../lib/editor/format/format-overrides';
import {copyTextFormat} from '../lib/editor/format/format-copy';
import {parseDocument} from '../lib/infrastructure/persistence/document-codec';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
import {exportHTML} from '../lib/infrastructure/export/html-export';
import {previewSource} from '../lib/infrastructure/preview/paged-preview';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(op=>op==='undo'||op==='redo'?engine.history(op).ok:engine.execute({source:'keyboard',operations:[op]}).ok),content:'<h2>Heading 中文</h2><p><a href="https://example.com">Linked 日本語</a></p><p>Plain العربية</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function select(text:string,caret=false){let p=-1;editor.state.doc.descendants((n,i)=>{if(n.isText&&n.text===text)p=i;});if(p<0)throw Error(text);editor.commands.setTextSelection({from:p,to:caret?p:p+text.length});}
const active=(mark:'bold'|'underline')=>effectiveFormatActive(editor.state,mark);
const off=()=>editor.state.doc.nodeAt(editor.state.selection.from)?.marks.find(m=>m.type.name==='formatOverride')?.attrs;
const toggle=(mark:'bold'|'underline')=>engine.execute({operations:[{type:'text.toggle',mark}]});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
it('turns inherited heading bold off, restores it and supports exact atomic undo/redo',()=>{
 select('Heading 中文');expect(active('bold')).toBe(true);const before=editor.getJSON();expect(toggle('bold').ok).toBe(true);expect(active('bold')).toBe(false);expect(off()?.boldOff).toBe(true);expect(editor.getHTML()).toContain('font-weight: 400');const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);toggle('bold');expect(active('bold')).toBe(true);expect(off()).toBeUndefined();
});
it('turns link underline off without removing its URL and wraps the anchor for actual CSS override',()=>{
 select('Linked 日本語');expect(active('underline')).toBe(true);toggle('underline');expect(active('underline')).toBe(false);const root=document.createElement('div');root.innerHTML=editor.getHTML();expect(root.querySelector('[data-underline-off="true"] > a')?.getAttribute('href')).toBe('https://example.com');const css='[data-vdoc-format-override][data-underline-off="true"] a{text-decoration:none}';expect(exportHTML('QA',editor.getHTML(),editor.getJSON())).toContain(css);expect(previewSource('QA',editor.getHTML(),editor.getJSON()).css).toContain(css);
});
it('preserves the other negative override when one format is reapplied',()=>{
 editor.commands.setContent('<h2><a href="https://example.com">Both</a></h2>');select('Both');engine.execute({operations:[{type:'text.style',style:{bold:false,underline:false}}]});expect(off()).toMatchObject({boldOff:true,underlineOff:true});toggle('bold');expect(off()).toMatchObject({boldOff:false,underlineOff:true});expect(active('bold')).toBe(true);expect(active('underline')).toBe(false);toggle('underline');expect(off()).toBeUndefined();
});
it('only changes the selected part of a link and leaves other text and URL intact',()=>{
 select('Linked 日本語');const p=editor.state.selection.from;editor.commands.setTextSelection({from:p+1,to:p+4});toggle('underline');expect(editor.state.doc.child(1).content.content.map(n=>[n.text,!!n.marks.find(m=>m.type.name==='formatOverride')])).toEqual([['L',false],['ink',true],['ed 日本語',false]]);expect(editor.state.doc.child(1).content.content.every(n=>n.marks.find(m=>m.type.name==='link')?.attrs.href==='https://example.com')).toBe(true);
});
it('does not record redundant positive or negative format changes',()=>{
 select('Heading 中文');for(const enabled of [false,true]){expect(engine.execute({operations:[{type:'text.style',style:{bold:enabled}}]}).ok).toBe(true);const revision=engine.revision;engine.execute({operations:[{type:'text.style',style:{bold:enabled}}]});expect(engine.revision).toBe(revision);}
});
it('does not add negative marks to plain body text',()=>{
 select('Plain العربية');const before=editor.getJSON();engine.execute({operations:[{type:'text.style',style:{bold:false,underline:false}}]});expect(editor.getJSON()).toEqual(before);
});
it('uses the latest draft state for repeated toggles in an atomic batch',()=>{
 select('Heading 中文');expect(engine.execute({operations:[{type:'text.toggle',mark:'bold'},{type:'text.toggle',mark:'bold'}]}).ok).toBe(true);expect(active('bold')).toBe(true);expect(off()).toBeUndefined();
});
it('uses the latest selection and marks in native command chains',()=>{
 select('Heading 中文');editor.chain().toggleBold().toggleBold().run();expect(active('bold')).toBe(true);editor.commands.unsetBold();expect(active('bold')).toBe(false);editor.commands.setBold();expect(active('bold')).toBe(true);
 select('Linked 日本語');editor.chain().unsetUnderline().toggleUnderline().run();expect(active('underline')).toBe(true);
});
it('keeps pending caret overrides when typing and through JSON reload',()=>{
 select('Heading 中文',true);toggle('bold');expect(active('bold')).toBe(false);editor.commands.insertContent('New ');select('New ');expect(off()?.boldOff).toBe(true);const saved=parseDocument(JSON.stringify({version:1,title:'QA',content:editor.getJSON()}));editor.commands.setContent(saved.content);select('New ');expect(active('bold')).toBe(false);
});
it('handles header cell selections without changing geometry or unselected cells',()=>{
 editor.commands.setContent('<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>');const map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0],1+map.map[1])));const grid=engine.snapshot().tables;expect(active('bold')).toBe(true);toggle('bold');expect(active('bold')).toBe(false);expect(engine.snapshot().tables).toEqual(grid);select('C');expect(off()).toBeUndefined();
});
it('copies negative formats to a heading link, then restores positive formats without losing the URL',()=>{
 select('Plain العربية');const plain=copyTextFormat(editor)!;editor.commands.setContent('<h2><a href="https://example.com">Target</a></h2>');select('Target');engine.execute({operations:[{type:'format.apply',format:plain}]});expect(copyTextFormat(editor)).toMatchObject({bold:false,underline:false});expect(off()).toMatchObject({boldOff:true,underlineOff:true});const rev=engine.revision;engine.execute({operations:[{type:'format.apply',format:plain}]});expect(engine.revision).toBe(rev);engine.execute({operations:[{type:'format.apply',format:{...plain,bold:true,underline:true}}]});expect(copyTextFormat(editor)).toMatchObject({bold:true,underline:true});expect(off()).toBeUndefined();expect(editor.getHTML()).toContain('href="https://example.com"');
});
it('clear formatting removes character overrides and restores the heading default',()=>{
 select('Heading 中文');toggle('bold');engine.execute({operations:[{type:'text.clear'}]});expect(active('bold')).toBe(true);expect(off()).toBeUndefined();
});
it('keyboard shortcuts follow effective appearance in headings and links',()=>{
 const key=(value:string)=>editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:value,ctrlKey:true,bubbles:true,cancelable:true}));select('Heading 中文');key('b');expect(active('bold')).toBe(false);select('Linked 日本語');key('u');expect(active('underline')).toBe(false);
});
it('can checks do not change draft marks and code-only targets are rejected',()=>{
 select('Heading 中文');const before=editor.getJSON();expect(editor.can().unsetBold()).toBe(true);expect(editor.getJSON()).toEqual(before);editor.commands.setContent('<pre><code>Code</code></pre>');select('Code');expect(editor.can().toggleBold()).toBe(false);expect(toggle('bold').ok).toBe(false);
});
it('preserves negatives through HTML and validated backups and rejects invalid values',()=>{
 select('Heading 中文');toggle('bold');select('Linked 日本語');toggle('underline');const content=editor.getJSON(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});try{expect(other.getJSON()).toEqual(content);}finally{other.destroy();}expect(parseDocument(JSON.stringify({version:1,title:'QA',content})).content).toEqual(content);for(const attrs of [{boldOff:'true'},{underlineOff:1},{unknown:true},[],1])expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Bad',marks:[{type:'formatOverride',attrs}]}]}]}}))).toThrow();
});
it('preserves heading/link overrides and default heading bold through two actual DOCX roundtrips',async()=>{
 editor.commands.setContent('<h2>Default heading</h2><h2><a href="https://example.com">Normal heading link 中文</a></h2><p><a href="https://example.com">Normal link 日本語</a></p><table><tr><th><p>Normal header</p></th><th><p>Bold header</p></th></tr></table>');select('Normal heading link 中文');engine.execute({operations:[{type:'text.style',style:{bold:false,underline:false}}]});select('Normal link 日本語');toggle('underline');select('Normal header');toggle('bold');
 for(let i=0;i<2;i++){const buffer=await bytes(await exportWord(editor.getJSON(),'QA format overrides'));if(i===0&&process.env.VDOC_FORMAT_FIXTURE)writeFileSync('/private/tmp/vdoc-format-overrides.docx',Buffer.from(buffer));const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);for(const text of ['Normal heading link 中文','Normal link 日本語']){select(text);expect(active('underline')).toBe(false);}for(const text of ['Normal heading link 中文','Normal header']){select(text);expect(active('bold')).toBe(false);}for(const text of ['Default heading','Bold header']){select(text);expect(active('bold')).toBe(true);}}
});

it.each([1,2,3,4,5,6])('honors bold defaults and explicit off for heading level %i',(level)=>{
 editor.commands.setContent(`<h${level}>Level</h${level}>`);select('Level');expect(active('bold')).toBe(true);toggle('bold');expect(active('bold')).toBe(false);expect(copyTextFormat(editor)?.bold).toBe(false);
});
it('rolls back overrides when a later operation fails without recording a revision',()=>{
 select('Heading 中文');const before=editor.getJSON(),revision=engine.revision;expect(engine.execute({operations:[{type:'text.style',style:{bold:false}},{type:'list.indent',direction:'in'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);
});
