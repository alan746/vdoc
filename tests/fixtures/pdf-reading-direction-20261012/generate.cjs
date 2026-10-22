// Metadata-only QA control. Keep every original drawing stream and font.
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PDFDocument,PDFName}=require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdf-lib');
const out='tests/fixtures/pdf-reading-direction-20261012';
(async()=>{
 const inputs=[];
 for(const mode of ['page-visual','source-visual']){
  const original=`output/pdf/type0-minimal-20261011/hebrew-${mode}.pdf`;
  const report=JSON.parse(await fs.readFile(`tests/fixtures/pdf-type0-minimal-20261011/hebrew-${mode}.json`,'utf8'));
  const bytes=await fs.readFile(original),pdf=await PDFDocument.load(bytes,{updateMetadata:false});
  pdf.catalog.set(PDFName.of('ViewerPreferences'),pdf.context.obj({Direction:'R2L'}));
  const target=out+`/${mode}-r2l.pdf`,result=await pdf.save();
  await fs.writeFile(target,result,{flag:'wx'});
  const reopened=await PDFDocument.load(result);
  assert.equal(reopened.catalog.lookup(PDFName.of('ViewerPreferences')).get(PDFName.of('Direction')).toString(),'/R2L');
  inputs.push({label:mode+'-r2l',file:target,original,sourceText:report.sourceText,targets:report.targets,sha256:crypto.createHash('sha256').update(result).digest('hex'),originalSha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 await fs.writeFile(out+'/inputs.json',JSON.stringify(inputs,null,2),{flag:'wx'});
})().catch(e=>{console.error(e);process.exitCode=1});
