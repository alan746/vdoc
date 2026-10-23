import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import type { OperationRequest } from '../lib/domain/entities/operation';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { activateDocument, saveDocument, openArchivedDocument } from '../lib/infrastructure/persistence/document-store';
import { saveVersion, restoreVersion } from '../lib/infrastructure/persistence/version-store';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { languageSamples, unicodeSamples } from './multilingual-fixtures';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
const initial:JSONContent={type:'doc',content:[
  {type:'heading',attrs:{level:1},content:[{type:'text',text:'Complex multilingual acceptance'}]},
  ...languageSamples.map(([locale,text])=>({...p(text),attrs:{direction:['ar','he','fa','ur'].includes(locale)?'rtl':'auto'}})),
  ...unicodeSamples.map(p),
  {type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[p('第三项'),{type:'bulletList',content:[{type:'listItem',content:[p('nested العربية')]}]}]},{type:'listItem',content:[p('Fourth item')]}]},
  {type:'table',content:[['Name','内容','עברית'],['20','你好','שלום'],['10','こんにちは','مرحبا']].map((row,i)=>({type:'tableRow',content:row.map(text=>({type:i?'tableCell':'tableHeader',content:[p(text)]}))}))},
  {type:'paragraph',content:[{type:'text',text:'Source '},{type:'footnote',attrs:{number:1,text:'注释 · العربية · हिन्दी'}}]},
  {type:'image',attrs:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',width:120,alt:'示意图 · مخطط'}},
  {type:'pageBreak'},p('Final page · 最后一页'),
]};
let editor:Editor|undefined,engine:DocumentEngine|undefined;
afterEach(()=>{engine?.destroy();editor?.destroy();vi.unstubAllGlobals();});
it('executes and reverses a mixed-language multi-step editing workflow, then preserves the final draft across storage, version restore and Word',async()=>{
  editor=new Editor({extensions:createExtensions(),content:initial});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);
  const before:JSONContent[]=[],after:JSONContent[]=[];
  const apply=(request:Partial<OperationRequest> & {operations:unknown[]})=>{
    before.push(editor!.getJSON());
    const result=engine!.execute(request);expect(result,JSON.stringify(request.operations)).toMatchObject({ok:true});
    editor!.state.doc.check();after.push(editor!.getJSON());
    expect(parseDocument(JSON.stringify({version:1,title:'Complex',content:editor!.getJSON()})).content).toEqual(editor!.getJSON());
  };
  const block=(text:string)=>({kind:'block' as const,id:engine!.snapshot().blocks.find(b=>b.text===text)!.id});
  const table=(row:number,col:number,endRow=row,endCol=col)=>({kind:'cells' as const,tableId:engine!.snapshot().blocks.find(b=>b.type==='table')!.id,row,col,endRow,endCol});
  apply({operations:[{type:'document.language',language:'zh-Hant-TW'},{type:'document.layout',pageSize:'letter',orientation:'landscape',pageMargin:18,pageColor:'#FFFFFF',header:'多语言 review',footer:'نهاية',pageNumbers:true}]});
  apply({target:block('Complex multilingual acceptance'),operations:[{type:'paragraph.style',align:'center',spaceAfter:24},{type:'text.style',style:{color:'#4485D1',underline:true}}]});
  apply({target:block('สวัสดีชาวโลก'),operations:[{type:'text.style',style:{highlight:'#FFF0AD',fontFamily:'Noto Sans SC'}},{type:'link.set',href:'https://example.com/thai'}]});
  apply({operations:[{type:'text.findReplace',query:'café',replacement:'CAFÉ ✅'}]});
  apply({target:table(1,0,1,2),operations:[{type:'table.background',color:'#D8EFDE'},{type:'table.style',padding:16,verticalAlign:'middle',borderWidth:2,borderColor:'#4485D1'}]});
  apply({target:table(0,0,0,2),operations:[{type:'table.edit',action:'merge'}]});
  apply({target:table(0,0),operations:[{type:'table.edit',action:'split'}]});
  apply({target:table(1,0),operations:[{type:'table.sort',column:0,descending:false}]});
  apply({target:table(1,0),operations:[{type:'table.move',axis:'row',from:1,to:2}]});
  apply({target:table(1,1),operations:[{type:'table.widths',widths:[150,180,210]}]});
  apply({target:block('مرحبا بالعالم'),operations:[{type:'paragraph.style',direction:'rtl',spaceBefore:12,spaceAfter:16},{type:'text.style',style:{bold:true,highlight:'#EADFF6'}}]});
  const final=editor.getJSON();
  for(let i=before.length-1;i>=0;i--){expect(engine.history('undo').ok).toBe(true);expect(editor.getJSON(),`undo step ${i+1}`).toEqual(before[i]);}
  for(let i=0;i<after.length;i++){expect(engine.history('redo').ok).toBe(true);expect(editor.getJSON(),`redo step ${i+1}`).toEqual(after[i]);}
  expect(editor.getJSON()).toEqual(final);
  // Failed batches must not retain an earlier valid edit from that same batch.
  const revision=engine.revision;
  expect(engine.execute({expectedRevision:revision-1,target:{kind:'range',from:1,to:2},operations:[{type:'text.delete'}]}).ok).toBe(false);
  expect(engine.execute({target:table(1,0),operations:[{type:'table.background',color:'#FFFFFF'},{type:'table.widths',widths:[90]}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(final);
  const saved=await activateDocument({version:1,id:crypto.randomUUID(),title:'Complex workflow',content:final,savedAt:new Date().toISOString()});
  const version=await saveVersion(saved,'Reviewed multilingual draft');
  const changed=await saveDocument('Later draft',{type:'doc',content:[p('Temporary later work')]},saved.id);
  const restored=await restoreVersion(version.key,changed);
  expect(restored.content).toEqual(final);expect((await openArchivedDocument(saved.id)).content).toEqual(final);
  // jsdom does not decode images. Supply the known fixture dimensions only;
  // actual DOCX generation, embedded bytes and import still use the real libraries.
  vi.stubGlobal('Image',class { naturalWidth=1; naturalHeight=1; onload:(()=>void)|null=null; set src(_:string){queueMicrotask(()=>this.onload?.());} });
  const word=await importWord(await bytes(await exportWord(final,'Complex workflow')));
  const valid=parseDocument(JSON.stringify({version:1,title:'Word',content:word.content})).content;
  expect(valid.attrs).toMatchObject({language:'zh-Hant-TW',orientation:'landscape',header:'多语言 review',footer:'نهاية',pageNumbers:true});
  const textNodes:string[]=[];const tableNodes:JSONContent[]=[];const walk=(node:JSONContent)=>{if(node.text)textNodes.push(node.text);if(node.type==='table')tableNodes.push(node);node.content?.forEach(walk);};walk(valid);
  const text=textNodes.join('');for(const [,sample]of languageSamples)expect(text).toContain(sample);
  expect(text).toContain('CAFÉ ✅');expect(text).toContain('👨‍👩‍👧‍👦');expect(JSON.stringify(valid)).toContain('注释 · العربية · हिन्दी');
  const imported=editor.schema.nodeFromJSON(tableNodes[0]);expect(TableMap.get(imported).width).toBe(3);expect(TableMap.get(imported).height).toBe(3);
});
