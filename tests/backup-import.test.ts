import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {beforeEach,expect,it,vi} from 'vitest';
import {parseDocument} from '../lib/editor/storage';
import {importDocumentFile} from '../lib/editor/import-file';

beforeEach(()=>{localStorage.clear();globalThis.indexedDB=new IDBFactory();vi.resetModules();});
const backup=(text='Keep 中文 العربية')=>({version:1,title:'Local backup',savedAt:'2026-10-02T12:00:00.000Z',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}});
// jsdom File lacks Blob.text/arrayBuffer; use FileReader over actual UTF-8 bytes.
function file(raw:string | Uint8Array<ArrayBuffer>,name='Restore.vdoc.json') {
 const value=new File([raw],name,{type:'application/json'});
 Object.defineProperty(value,'text',{value:()=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(value);})});
 Object.defineProperty(value,'arrayBuffer',{value:()=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(value);})});
 return value;
}
it.each(['title','body','footer'] as const)('rejects corrupt UTF-8 inside a syntactically valid backup %s',async field=>{
 const value={...backup(field==='body'?'BEFORE@AFTER':'Keep 中文 العربية'),title:field==='title'?'BEFORE@AFTER':'Local backup',content:{...backup(field==='body'?'BEFORE@AFTER':'Keep 中文 العربية').content,attrs:{footer:field==='footer'?'BEFORE@AFTER':''}}};
 const bytes=new TextEncoder().encode(JSON.stringify(value));bytes[bytes.indexOf(0x40)]=0xff;
 // Permissive decoding silently changes a character and JSON/schema validation still succeeds.
 expect(()=>parseDocument(new TextDecoder().decode(bytes))).not.toThrow();
 await expect(importDocumentFile(file(bytes))).rejects.toThrow('invalid UTF-8');
});
it('preserves a legitimate replacement symbol, Unicode and formatting in a valid UTF-8 backup',async()=>{
 const value={...backup('Literal � 中文 👩‍💻 café العربية'),content:{type:'doc',attrs:{footer:'Footer �'},content:[{type:'paragraph',content:[{type:'text',text:'Literal � 中文 👩‍💻 café العربية',marks:[{type:'bold'},{type:'highlight',attrs:{color:'#FEF08A'}}]}]}]}};
 const raw=JSON.stringify(value);expect(await importDocumentFile(file(raw))).toEqual(parseDocument(raw));
});
it('reimports a native backup larger than the old limit with embedded images and exact stored content',async()=>{
 const store=await import('../lib/editor/document-store');
 const document=backup();const image={type:'image',attrs:{src:'data:image/png;base64,'+'A'.repeat(1_400_000),alt:'Backup image'}};
 const normalized=parseDocument(JSON.stringify({...document,content:{type:'doc',content:[...document.content.content,...Array.from({length:15},()=>image)]}}));
 const saved=await store.activateDocument({...normalized,id:'large-backup'});
 const exported=JSON.stringify({version:1,title:saved.title,content:saved.content,savedAt:saved.savedAt},null,2);
 expect(exported.length).toBeGreaterThan(20_000_000);
 const imported=await importDocumentFile(file(exported));expect(imported.content).toEqual((await store.openArchivedDocument(saved.id)).content);
 expect(imported.title).toBe(saved.title);expect(imported.id).toBeUndefined();
 const restored=await store.activateDocument({...imported,id:'separate-restored-copy'});expect(restored.id).not.toBe(saved.id);
 expect((await store.openArchivedDocument(saved.id)).content).toEqual((await store.readSavedDocument()).data!.content);
});
it('uses the same native-backup policy for UTF-8 bytes and JavaScript character lengths',async()=>{
 const raw=JSON.stringify(backup('中'.repeat(6_700_000))),upload=file(raw);
 expect(raw.length).toBeLessThan(20_000_000);expect(upload.size).toBeGreaterThan(20_000_000);
 expect((await importDocumentFile(upload)).content.content![0].content![0].text).toBe('中'.repeat(6_700_000));
});
it('rejects a damaged large backup before changing the active document or local library',async()=>{
 const store=await import('../lib/editor/document-store');const current=await store.activateDocument({...parseDocument(JSON.stringify(backup())),id:'keep-original'});
 const raw=JSON.stringify({...backup(),padding:' '.repeat(20_000_001),content:{type:'doc',content:[{type:'image',attrs:{src:'https://invalid.test/image.png'}}]}});
 await expect(importDocumentFile(file(raw))).rejects.toThrow('Images must be embedded');
 expect((await store.readSavedDocument()).data).toEqual(current);expect((await store.listDocuments()).map(d=>d.id)).toEqual([current.id]);
});
it.each(['Oversized.docx','Oversized.TXT'])('keeps the separate 20 MB conversion limit for %s without reading the file',async name=>{
 const text=vi.fn(),arrayBuffer=vi.fn();const upload={name,size:20_000_001,text,arrayBuffer} as unknown as File;
 await expect(importDocumentFile(upload)).rejects.toThrow('20 MB');expect(text).not.toHaveBeenCalled();expect(arrayBuffer).not.toHaveBeenCalled();
});
it('accepts a UTF-8 BOM while retaining the document content and metadata',async()=>{
 const raw=JSON.stringify(backup());expect(parseDocument('\uFEFF'+raw)).toEqual(parseDocument(raw));expect(await importDocumentFile(file('\uFEFF'+raw))).toEqual(parseDocument(raw));
});
it.each(['null','[]','42','{"version":1,','{"version":1,"title":"Bad","content":{"type":"doc","content":[null]}}'])('rejects malformed native JSON with a readable error: %s',async raw=>{
 await expect(importDocumentFile(file(raw))).rejects.toThrow(/backup|document/i);
});
