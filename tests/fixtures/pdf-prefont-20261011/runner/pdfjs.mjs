import fs from 'node:fs/promises';
import {getDocument} from '/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const fixture=JSON.parse(await fs.readFile('tests/fixtures/pdf-prefont-20261011/flow.vdoc.json','utf8'));
const text=n=>(n.text||'')+(n.content||[]).map(text).join('');const hindi=t=>[...t.normalize('NFKC')].filter(c=>/[\u0900-\u097f]/.test(c)).join('');const expected=hindi(text(fixture.content));const results=[];
for(const file of ['output/pdf/pdf-prefont-20261011/flow-fallback-contextual.pdf','output/pdf/safari-native-20261011/flow-native-101.pdf']){
 const pdf=await getDocument({data:new Uint8Array(await fs.readFile(file)),useSystemFonts:true,disableFontFace:true}).promise;const pages=[];
 for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);pages.push((await page.getTextContent()).items.map(x=>x.str).join(''));}
 const actual=hindi(pages.join(''));results.push({file,pages:pdf.numPages,hindiOrder:actual===expected,actualHindi:actual.length,expectedHindi:expected.length,actual,expected});console.log(file,actual===expected,actual.length,expected.length);await pdf.destroy();
}
await fs.writeFile('tests/fixtures/pdf-prefont-20261011/pdfjs.json',JSON.stringify(results,null,2));
