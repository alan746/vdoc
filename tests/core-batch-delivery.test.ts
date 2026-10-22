import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {Editor,type JSONContent} from '@tiptap/core';
import {colorToHex} from '../lib/editor/color';
import {createExtensions} from '../lib/editor/extensions';
import {readDocumentImport} from '../lib/editor/import-file';
import {effectiveFormatActive} from '../lib/editor/format-overrides';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
const path=(ext:string)=>`tests/fixtures/core-batch-20261006/downloaded.${ext}`;
const backup=JSON.parse(readFileSync(path('vdoc.json'),'utf8'));
const nodes=(n:JSONContent):JSONContent[]=>[n,...(n.content||[]).flatMap(nodes)];
const text=(n:JSONContent):string=>n.text??(n.content||[]).map(text).join('');
async function read(ext:string){
 const file=new File([Uint8Array.from(readFileSync(path(ext)))],`QA core batch.${ext}`);
 Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(file);})});
 return readDocumentImport(file);
}
let word:Awaited<ReturnType<typeof read>>,editor:Editor;
beforeAll(async()=>{word=await read('docx');editor=new Editor({extensions:createExtensions(),content:word.document.content});});
afterAll(()=>editor.destroy());
it('reimports the actual page-downloaded backup exactly, without a document identity',async()=>{
 const result=await read('vdoc.json');expect(result.document).toEqual(backup);expect(result.document.id).toBeUndefined();expect(result.warnings).toEqual([]);
});
it('retains every text block, Unicode sequence, list order and explicit final page break from actual Word download',()=>{
 expect(word.warnings).toEqual([]);
 const paragraphs=(content:JSONContent)=>nodes(content).filter(n=>['heading','paragraph'].includes(n.type||'')&&text(n)).map(text);
 expect(paragraphs(word.document.content)).toEqual(paragraphs(backup.content));
 for(const type of ['orderedList','bulletList','pageBreak'])expect(nodes(word.document.content).filter(n=>n.type===type)).toHaveLength(1);
 expect(paragraphs(word.document.content)[1]).toBe('Workflow AFTER 中文 日本語 العربية हिन्दी 👩‍💻 é Reference link');
 const content=word.document.content.content!;const page=content.findIndex(n=>n.type==='pageBreak');expect(content[page+1]).toMatchObject({type:'heading',attrs:{level:2}});expect(text(content[page+1])).toBe('FINAL PAGE CHECK 中文');
});
it('keeps all 36 body rows once and the 18 merged groups without changing grid geometry',()=>{
 const source=nodes(backup.content).find(n=>n.type==='table')!,target=nodes(word.document.content).find(n=>n.type==='table')!;
 const geometry=(table:JSONContent)=>table.content!.map(row=>row.content!.map(cell=>[cell.attrs?.rowspan,cell.attrs?.colspan]));
 expect(geometry(target)).toEqual(geometry(source));expect(target.content).toHaveLength(37);expect(target.attrs?.pinnedRows).toBe(1);
 const values=nodes(target).filter(n=>n.type==='paragraph').map(text);
 for(let row=1;row<=36;row++)expect(values.filter(v=>v.startsWith(`ROW ${String(row).padStart(2,'0')} —`))).toHaveLength(1);
});
it('keeps resized image bytes, dimensions, aspect ratio and multilingual alt text',()=>{
 const source=nodes(backup.content).find(n=>n.type==='image')!.attrs!,target=nodes(word.document.content).find(n=>n.type==='image')!.attrs!;
 expect(target).toMatchObject({src:source.src,width:240,height:120,alt:'QA blue orange 中文 العربية'});
});
it('keeps cell-local background and italic text without spreading the format to neighboring rows',()=>{
 const source=nodes(backup.content).find(n=>n.type==='table')!,target=nodes(word.document.content).find(n=>n.type==='table')!;
 const backgrounds=(n:JSONContent)=>nodes(n).filter(n=>['tableHeader','tableCell'].includes(n.type||'')).map(n=>colorToHex(n.attrs?.backgroundColor));
 expect(backgrounds(target)).toEqual(backgrounds(source));
 const italic=(n:JSONContent)=>nodes(n).filter(n=>n.type==='text'&&n.marks?.some(m=>m.type==='italic')).map(text).join('');
 expect(italic(target)).toBe(italic(source));expect(italic(target)).toContain('ROW 02');
});
it('keeps explicitly disabled heading bold and link underline in downloaded Word',()=>{
 function select(value:string){let from=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===value)from=p;});expect(from).toBeGreaterThan(-1);editor.commands.setTextSelection({from,to:from+value.length});}
 select('VDoc core system acceptance');expect(effectiveFormatActive(editor.state,'bold')).toBe(false);
 select('Reference link');expect(effectiveFormatActive(editor.state,'underline')).toBe(false);expect(editor.getAttributes('link').href).toBe('https://example.com');
});
