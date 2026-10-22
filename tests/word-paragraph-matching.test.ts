import {expect,it,vi} from 'vitest';
import type {JSONContent} from '@tiptap/core';
import {exportWord,importWord} from '../lib/editor/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
const p=(text?:string,attrs?:Record<string,unknown>):JSONContent=>({type:'paragraph',attrs,...(text?{content:[{type:'text',text}]}:{})});
const cell=(content:JSONContent[],rowspan=1):JSONContent=>({type:'tableCell',attrs:{rowspan,colspan:1},content});
const table:JSONContent={type:'table',content:[{type:'tableRow',content:[cell([p('Merge')],2),cell([p('First')])]},{type:'tableRow',content:[cell([p('Second',{spaceBefore:17,spaceAfter:23})])]}]};
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const round=async(content:JSONContent)=>(await importWord(await bytes(await exportWord(content,'Paragraph matching')))).content;
it('does not let vertical merge placeholders consume a later empty paragraph or page break',async()=>{
 const source:JSONContent={type:'doc',content:[table,p('After table',{spaceBefore:19}),{type:'pageBreak'},p('Final')]};
 const result=await round(source);expect(result.content!.map(n=>n.type)).toEqual(['table','paragraph','pageBreak','paragraph']);expect(result.content![1].attrs?.spaceBefore).toBe(19);expect(result.content![0].content![1].content![0].content![0].attrs).toMatchObject({spaceBefore:17,spaceAfter:23});
});
it('does not borrow formatting from a merge placeholder for a real empty paragraph',async()=>{
 const result=await round({type:'doc',content:[table,p(undefined,{spaceAfter:31}),p('Last')]});expect(result.content![1].attrs?.spaceAfter).toBe(31);expect(result.content![0].content![1].content![0].content![0].attrs).toMatchObject({spaceBefore:17,spaceAfter:23});
});
it.each([['leading',[{type:'pageBreak'},p('Text')]],['trailing',[p('Text'),{type:'pageBreak'}]],['consecutive',[p('Before'),{type:'pageBreak'},{type:'pageBreak'},p('After')]]])('preserves %s explicit page breaks through two roundtrips without growing blank paragraphs',async(_name,blocks)=>{
 const input:JSONContent={type:'doc',content:blocks as JSONContent[]};let result=input;for(let i=0;i<2;i++)result=await round(result);expect(result.content!.map(n=>n.type)).toEqual(input.content!.map(n=>n.type));
});
