import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { selectedIndent, indentOperation, paragraphIndent } from '../lib/editor/paragraph/paragraph-indent';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<p>English 中文</p><p dir="rtl">العربية עברית</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
it('preserves precise physical HTML margins and first line offset when importing',()=>{
 editor.commands.setContent('<p style="margin-left:37.5px;margin-right:12.25px;text-indent:-24px">Hanging</p><p dir="rtl" style="margin-right:37.5px;margin-left:12.25px;text-indent:24px">العربية</p>');
 expect(paragraphIndent(editor.state.doc.child(0).attrs)).toEqual({indentStart:13.5,indentEnd:12.25,firstLineIndent:-24});expect(paragraphIndent(editor.state.doc.child(1).attrs)).toEqual({indentStart:37.5,indentEnd:12.25,firstLineIndent:24});
});
it('converts absolute HTML units into pixels instead of treating points and inches as pixels',()=>{
 editor.commands.setContent('<p style="margin-left:0.5in;margin-right:18pt;text-indent:-12pt">Units</p>');expect(paragraphIndent(editor.state.doc.firstChild!.attrs)).toEqual({indentStart:32,indentEnd:24,firstLineIndent:-16});
});
it.each([36,-36,0])('applies special indent %s without changing text/spacing/IDs; HTML and backup round trip and one undo',amount=>{
 editor.commands.selectAll();const before=editor.getJSON();expect(engine.execute({operations:[{type:'paragraph.style',firstLineIndent:amount,indentStart:12.5,indentEnd:6.25}]}).ok).toBe(true);
 const after=editor.getJSON();expect(after.content!.map(p=>p.content)).toEqual(before.content!.map(p=>p.content));
 const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Indent',content:after})).content).toEqual(after);
 expect(editor.getHTML()).toContain(`margin-inline-start: ${12.5+Math.max(0,-amount)}px`);expect(editor.getHTML()).toContain(`text-indent: ${amount}px`);
 engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it('preserves legacy levels while explicit precise indentation takes precedence, and supports old commands',()=>{
 editor.commands.setContent({type:'doc',content:[{type:'paragraph',attrs:{indent:2},content:[{type:'text',text:'Old'}]}]});expect(paragraphIndent(editor.state.doc.firstChild!.attrs).indentStart).toBe(48);
 engine.execute({operations:[{type:'paragraph.style',indentStart:37.5,firstLineIndent:-24}]});expect(paragraphIndent(editor.state.doc.firstChild!.attrs).indentStart).toBe(37.5);
 engine.execute({operations:[{type:'paragraph.style',indent:3}]});expect(paragraphIndent(editor.state.doc.firstChild!.attrs)).toEqual({indentStart:72,indentEnd:0,firstLineIndent:-24});
});
it('shows mixed fields, makes unchanged Apply a no-op, and changes only one field',()=>{
 editor.commands.setContent('<p data-indent-start="12" data-first-line-indent="24">A</p><p data-indent-start="37.5" data-first-line-indent="-48">B</p>');editor.commands.selectAll();const before=selectedIndent(editor);
 expect(before).toEqual({indentStart:null,indentEnd:0,firstLineIndent:null});expect(indentOperation(before,{...before})).toBeNull();const operation=indentOperation(before,{...before,firstLineIndent:0});expect(operation).toEqual({type:'paragraph.style',firstLineIndent:0});engine.execute({operations:[operation]});expect(editor.state.doc.child(0).attrs.indentStart).toBe(12);expect(editor.state.doc.child(1).attrs.indentStart).toBe(37.5);
});
it('increments each selected paragraph by 24px without flattening mixed custom distances',()=>{
 editor.commands.setContent('<p data-indent-start="12.5" data-first-line-indent="24">A</p><p data-indent-start="37.5" data-first-line-indent="-48">B</p>');editor.commands.selectAll();const before=editor.getJSON();engine.execute({operations:[{type:'paragraph.indent',direction:'in'}]});expect(editor.state.doc.child(0).attrs.indentStart).toBe(36.5);expect(editor.state.doc.child(1).attrs.indentStart).toBe(61.5);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it.each(['indentStart','indentEnd','firstLineIndent'])('rejects malformed %s parameters and backup values without partial edits',key=>{
 const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'Rejected'},{type:'paragraph.style',[key]:'24'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);const content:JSONContent=JSON.parse(JSON.stringify(before));content.content![0].attrs![key]=10001;expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content}))).toThrow('indentation');
});
it.each([['ltr',24],['ltr',-24],['rtl',24],['rtl',-24]] as const)('round-trips %s special indent %s through Word bytes without rounding to levels',async(direction,firstLineIndent)=>{
 editor.commands.selectAll();engine.execute({operations:[{type:'paragraph.style',direction,indentStart:37.5,indentEnd:12.2,firstLineIndent}]});const buffer=await bytes(await exportWord(editor.getJSON(),'Indent'));
 const zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml')!.async('string');expect(xml).toContain(firstLineIndent>0?'w:firstLine="360"':'w:hanging="360"');
 const output=await importWord(buffer);for(const node of output.content.content!){const value=paragraphIndent(node.attrs!);expect(value.indentStart).toBeCloseTo(37.5,1);expect(value.indentEnd).toBeCloseTo(12.2,1);expect(value.firstLineIndent).toBe(firstLineIndent);expect(node.attrs!.direction).toBe(direction);}
});
it('preserves a deliberate outdent when Word has hanging greater than its left margin',async()=>{
 editor.commands.selectAll();engine.execute({operations:[{type:'paragraph.style',indentStart:-24,firstLineIndent:-24,direction:'ltr'}]});const output=await importWord(await bytes(await exportWord(editor.getJSON(),'Outdent')));expect(paragraphIndent(output.content.content![0].attrs!)).toMatchObject({indentStart:-24,firstLineIndent:-24});
});
it.each(['bulletList','orderedList'])('keeps %s level indentation separate from paragraph hanging indentation in Word',async type=>{
 const p=(text:string)=>({type:'paragraph',attrs:{indentStart:12.5,firstLineIndent:-24},content:[{type:'text',text}]});
 const input:JSONContent={type:'doc',content:[{type,content:[{type:'listItem',content:[p('Outer'),{type,content:[{type:'listItem',content:[p('Nested')]}]}]}]}]};
 const buffer=await bytes(await exportWord(input,'List indent'));const zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml')!.async('string');
 expect(xml).toContain('w:left="908"');expect(xml).toContain('w:left="1268"');
 const result=await importWord(buffer),values:any[]=[];const visit=(n:JSONContent)=>{if(n.type==='paragraph')values.push(paragraphIndent(n.attrs!));n.content?.forEach(visit);};visit(result.content);
 expect(values.length).toBeGreaterThanOrEqual(2);for(const value of values.slice(0,2)){expect(value.indentStart).toBeCloseTo(12.5,1);expect(value.firstLineIndent).toBe(-24);}
});
