const fs=require('fs'), cp=require('child_process');
const dir='tests/fixtures/pdf-direction-space-20261012';
const cases=[['words',false,false],['arabic',false,false],['hebrew',false,false],['arabic',true,false],['hebrew',true,false],['arabic',false,true]];
for(const [lang,marked,numbers] of cases){const label=lang+(marked?'-marked':'')+(numbers?'-numbers':'');const output=cp.execFileSync(process.execPath,[dir+'/generate.cjs',lang,'unicode'],{env:{...process.env,VDOC_QA_WHOLE_CLUSTER:'1',VDOC_QA_MARKED:marked?'1':'0',VDOC_QA_NUMBER_CASES:numbers?'1':'0'},timeout:60000,encoding:'utf8'});fs.writeFileSync(dir+'/generate-'+label+'.log',output,{flag:'wx'});console.log(output.trim());}
