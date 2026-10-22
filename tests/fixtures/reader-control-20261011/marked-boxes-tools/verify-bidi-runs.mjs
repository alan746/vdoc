// QA-only extraction audit. Whitespace-stripped matches are NOT a product pass.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const encoding=process.env.VDOC_QA_READER_VARIANT||'bidi-runs';
if(!['bidi-runs','whole-cluster','cluster-actual','local-clusters','record-actual','record-rtl','record-boxes','record-alef','record-digits','record-flow','record-number-tail','record-marked-boxes'].includes(encoding))throw Error('Unknown QA extraction variant');
const destination=`tests/fixtures/reader-control-20261011/${encoding}-pdfjs.json`;
try{await fs.access(destination);throw Error('Refuse overwrite extraction evidence');}catch(e){if(e.code!=='ENOENT')throw e;}
import {getDocument} from '/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const results=[];
for(const file of (await fs.readdir('output/pdf/browser-unicode-20261011')).filter(x=>x.endsWith('.pdf')&&x.includes('-'+encoding)).sort()) {
 const name=file.slice(0,-4),r=JSON.parse(await fs.readFile('tests/fixtures/browser-unicode-20261011/'+(name==='words'?'report':name+'-report')+'.json','utf8'));
 const doc=await getDocument({data:new Uint8Array(await fs.readFile('output/pdf/browser-unicode-20261011/'+file)),useSystemFonts:false}).promise;
 const content=await(await doc.getPage(1)).getTextContent();
 const text=content.items.map(x=>x.str+(x.hasEOL?'\n':'')).join('');
 const normalize=s=>s.replace(/\s/g,'');
 const sourceWords=r.sourceText.split(/\s+/).filter(x=>/[\u0900-\u097f\u0590-\u05ff\u0600-\u06ff]/u.test(x));
 const missingWholeWords=[...new Set(sourceWords)].filter(word=>!text.includes(word));
 results.push({name,pdfSha256:createHash('sha256').update(await fs.readFile('output/pdf/browser-unicode-20261011/'+file)).digest('hex'),matchCollapsed:text.replace(/\s+/gu,' ').trim()===r.sourceText.replace(/\s+/gu,' ').trim(),pages:doc.numPages,text,source:r.sourceText,exactIgnoringWhitespace:normalize(text)===normalize(r.sourceText),missingWholeWords,items:content.items.map(({str,hasEOL,transform,width,height})=>({str,hasEOL,transform,width,height}))});
 await doc.destroy();
}
await fs.writeFile(destination,JSON.stringify(results,null,2),{flag:'wx'});
console.log(results.map(({name,exactIgnoringWhitespace,missingWholeWords})=>({name,exactIgnoringWhitespace,missingWholeWords})));
