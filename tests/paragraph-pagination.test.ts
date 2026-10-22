import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { selectedPagination, paginationOperation, paragraphPagination } from '../lib/editor/paragraph-pagination';
import { parseDocument } from '../lib/editor/storage';
import { exportWord, importWord } from '../lib/editor/word';
import { previewSource } from '../lib/editor/paged-preview';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor, engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<h2>Heading العربية</h2><p>Body 日本語 हिन्दी</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
it('preserves existing heading/body defaults and reports mixed values across both',()=>{
 expect(paragraphPagination(editor.state.doc.firstChild!)).toEqual({keepWithNext:true,keepLinesTogether:false,preventSingleLines:true});
 editor.commands.selectAll();expect(selectedPagination(editor)).toEqual({keepWithNext:'mixed',keepLinesTogether:false,preventSingleLines:true});
 const mixed=selectedPagination(editor);expect(paginationOperation(mixed,{...mixed})).toBeNull();expect(paginationOperation(mixed,{...mixed,keepLinesTogether:true})).toEqual({type:'paragraph.style',keepLinesTogether:true});
});
it('applies only requested pagination properties across heading, body, list and table with one exact undo',()=>{
 editor.commands.setContent('<h2>Heading</h2><p>Body</p><ul><li><p>List</p></li></ul><table><tr><td><p>Cell</p></td></tr></table>');editor.commands.selectAll();const before=editor.getJSON();
 expect(engine.execute({operations:[{type:'paragraph.style',keepLinesTogether:true,preventSingleLines:false}]}).ok).toBe(true);
 editor.state.doc.descendants(n=>{if(['paragraph','heading'].includes(n.type.name))expect(n.attrs).toMatchObject({keepWithNext:null,keepLinesTogether:true,preventSingleLines:false});});
 const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it.each([true,false])('round trips explicit %s flags through HTML, backup, preview and real DOCX',async value=>{
 editor.commands.selectAll();expect(engine.execute({operations:[{type:'paragraph.style',keepWithNext:value,keepLinesTogether:value,preventSingleLines:value}]}).ok).toBe(true);
 const original=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:'Layout',content:original})).content).toEqual(original);
 const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(original);other.destroy();
 const source=previewSource('Layout',editor.getHTML(),original);expect(source.html).toContain(`data-keep-with-next="${value}"`);expect(source.html).toContain(`orphans: ${value?2:1}`);
 const blob=await exportWord(original,'Layout'),bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml')!.async('string');for(const flag of ['keepNext','keepLines','widowControl'])expect(xml).toContain(value?`<w:${flag}/>`:`<w:${flag} w:val="false"/>`);
 const result=await importWord(bytes);for(const n of result.content.content!)expect(n.attrs).toMatchObject({keepWithNext:value,keepLinesTogether:value,preventSingleLines:value});
});
it('uses CSS when HTML has no explicit flags and lets explicit off override CSS',()=>{
 editor.commands.setContent('<p style="break-after:avoid-page;break-inside:avoid;orphans:1;widows:1">CSS</p><h2 data-keep-with-next="false" style="break-after:avoid">Off</h2>');
 expect(editor.state.doc.firstChild!.attrs).toMatchObject({keepWithNext:true,keepLinesTogether:true,preventSingleLines:false});expect(editor.state.doc.child(1).attrs.keepWithNext).toBe(false);
});
it.each(['keepWithNext','keepLinesTogether','preventSingleLines'])('rejects malformed %s operations atomically and validates backups',key=>{
 const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'No change'},{type:'paragraph.style',[key]:'false'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
 const content:JSONContent=JSON.parse(JSON.stringify(before));content.content![0].attrs![key]='false';expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content}))).toThrow('paragraph page-break');
});
it('applies explicit false without treating the operation as empty, preserving unrelated spacing',()=>{
 editor.commands.setContent('<h2 style="margin-top:24px">Title</h2>');expect(engine.execute({operations:[{type:'paragraph.style',keepWithNext:false}]}).ok).toBe(true);expect(editor.state.doc.firstChild!.attrs).toMatchObject({keepWithNext:false,spaceBefore:24});
});
