import fs from 'node:fs/promises';
import {getDocument} from '/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const files=['output/pdf/pdf-font-20261011/embedded-logical-b.pdf',...[100,101,93].map(s=>`output/pdf/safari-native-20261011/embedded-native-${s}.pdf`)];const results=[];
for(const file of files){
 const pdf=await getDocument({data:new Uint8Array(await fs.readFile(file)),useSystemFonts:true,disableFontFace:true}).promise;const pages=[];
 for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i),t=(await p.getTextContent()).items.map(x=>x.str).join('');const n=t.normalize('NFKC');pages.push({page:i,text:t,hindi:[...n].filter(c=>/[\u0900-\u097f]/.test(c)).join(''),cjk:[...n].filter(c=>/[\u3400-\u9fff]/.test(c)).length,nullCount:[...t].filter(x=>x==='\0').length});}
 const hindi=pages.map(x=>x.hindi).join(''),cjk=pages.reduce((s,p)=>s+p.cjk,0);results.push({file,pages,all18HindiInLogicalOrder:hindi==='हिन्दी'.repeat(18),all206Cjk:cjk===206});console.log(file,hindi==='हिन्दी'.repeat(18),cjk);await pdf.destroy();
}
await fs.writeFile('tests/fixtures/pdf-font-20261011/pdfjs-text.json',JSON.stringify(results,null,2));
