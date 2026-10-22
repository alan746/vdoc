import {writeFileSync} from 'node:fs';
const content=Array.from({length:2500},(_,i)=>({type:i%100===0?'heading':'paragraph',attrs:i%100===0?{level:2}:undefined,content:[{type:'text',text:`Record ${String(i+1).padStart(4,'0')} — `+('中文 日本語 العربية हिन्दी Ελληνικά English 👩‍💻 é. '.repeat(20)),...(i%100===0?{marks:[{type:'formatOverride',attrs:{boldOff:true,underlineOff:false}}]}:{})}]}));
const raw=JSON.stringify({version:1,title:'QA large backup 2500 2026-10-06',content:{type:'doc',content},savedAt:'2026-10-06T00:00:00.000Z'});
writeFileSync('/private/tmp/vdoc-large-core-batch.vdoc.json',raw);
console.log(JSON.stringify({bytes:Buffer.byteLength(raw),blocks:content.length,textCharacters:content.reduce((n,p)=>n+p.content[0].text.length,0)}));
