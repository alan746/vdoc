import {readFile,writeFile} from 'node:fs/promises';
import {renderLocalPdf} from '../../../scripts/local-pdf.mjs';
const snapshot=JSON.parse(await readFile('tmp/pdfs/seven-gates-current-100.pdf.json','utf8')).snapshot;
let css=snapshot.styles;
for(const [script,range] of [['Arabic','U+0600-06FF,U+0750-077F,U+08A0-08FF'],['Hebrew','U+0590-05FF'],['Devanagari','U+0900-097F']]){
 const bytes=await readFile(`tests/fixtures/browser-pdf-20261011/fonts/NotoSans${script}-static.ttf`);
 css+=`\n@font-face{font-family:QAExport;src:url(data:font/ttf;base64,${bytes.toString('base64')});unicode-range:${range};font-weight:100 900;}`;
}
css+='\n#preview-pages *{font-family:QAExport,Arial,sans-serif!important}';
const bytes=await renderLocalPdf({title:'QA font mapping control',html:snapshot.html,css,pages:snapshot.pages,pageSize:'a4',orientation:'portrait'});
await writeFile('tests/fixtures/local-pdf-fontmap-20261012/noto-control.pdf',bytes,{flag:'wx'});
console.log(bytes.length);
