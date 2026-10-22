import fs from 'node:fs/promises';
import {getDocument} from '/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const files=['repaired-b.pdf','normalized-b.pdf','global-order-b.pdf','incremental-b.pdf'];const results=[];
for(const name of files){const pdf=await getDocument({data:new Uint8Array(await fs.readFile('output/pdf/pdf-unicode-20261011/'+name)),useSystemFonts:true,disableFontFace:true}).promise;const pages=[];for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),t=(await page.getTextContent()).items.map(x=>x.str).join('');pages.push({page:i,text:t,nullCount:[...t].filter(x=>x==='\0').length});}results.push({file:name,pages});console.log(name,JSON.stringify(pages[0].text.match(/ROW 02.{0,65}/)?.[0]));await pdf.destroy();}
await fs.writeFile('tests/fixtures/pdf-unicode-20261011/pdfjs-text.json',JSON.stringify(results,null,2));
