import {readFile,writeFile} from 'node:fs/promises';
import {renderLocalPdf} from '../../../scripts/local-pdf.mjs';
const previous=JSON.parse(await readFile('tmp/pdfs/seven-gates-current-100.pdf.json','utf8'));
const bytes=await renderLocalPdf({title:'QA final system acceptance',html:previous.snapshot.html,css:previous.snapshot.styles,pages:previous.snapshot.pages,pageSize:'a4',orientation:'portrait'});
await writeFile('tests/fixtures/local-pdf-product-20261012/render.pdf',bytes,{flag:'wx'});
console.log(JSON.stringify({bytes:bytes.length,pages:previous.snapshot.pages}));
