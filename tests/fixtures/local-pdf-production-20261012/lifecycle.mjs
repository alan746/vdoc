import {spawn,execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import net from 'node:net';
import assert from 'node:assert/strict';
const reports=[];
function descendants(pid,depth=0){if(depth>4)return[];let values=[];try{values=execFileSync('pgrep',['-P',String(pid)],{encoding:'utf8'}).trim().split(/\s+/).map(Number).filter(Number.isInteger);}catch{}return values.flatMap(p=>[p,...descendants(p,depth+1)]);}
function portState(port){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.setTimeout(800);socket.once('connect',()=>{socket.destroy();resolve('listening')});socket.once('error',e=>resolve(e.code));socket.once('timeout',()=>{socket.destroy();resolve('unknown-timeout')});});}
for(const mode of ['ready-stop','startup-cancel']){
 const child=spawn(process.execPath,['scripts/start-local.mjs','--port','0','--persist-to','tmp/local-pdf-lifecycle-state'],{stdio:['ignore','pipe','pipe']});
 let output='',stopped=false,owned=[];const report={mode,pid:child.pid};
 const stop=()=>{if(stopped)return;stopped=true;owned=descendants(child.pid);child.kill('SIGTERM');};
 const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 const ready=new Promise(resolve=>{const record=chunk=>{output+=chunk.toString();if(mode==='startup-cancel'&&output.includes('wrangler'))stop();const match=/VDoc local production: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match)resolve(match[1]);};child.stdout.on('data',record);child.stderr.on('data',record);});
 const bound=setTimeout(()=>child.kill('SIGKILL'),60000);
 try{
  if(mode==='ready-stop'){
   const url=await Promise.race([ready,completed.then(x=>{throw Error('Exited before ready '+JSON.stringify(x))})]);
   report.url=url;report.pageStatus=(await fetch(url)).status;report.capabilityStatus=(await fetch(url+'/__vdoc/local-pdf')).status;
   assert.equal(report.pageStatus,200);assert.equal(report.capabilityStatus,200);stop();
  }
  report.exit=await completed;assert.equal(report.exit.code,0);
  report.ownedChildren=owned;
  report.remainingChildren=owned.filter(pid=>{try{process.kill(pid,0);return true}catch{return false}});
  assert.deepEqual(report.remainingChildren,[]);
  const internal=/Ready on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
  if(internal){report.workerPort=Number(internal[1]);report.workerPortState=await portState(report.workerPort);assert.equal(report.workerPortState,'ECONNREFUSED');}
  if(report.url){report.publicPortState=await portState(Number(new URL(report.url).port));assert.equal(report.publicPortState,'ECONNREFUSED');}
  report.passed=true;
 }catch(e){report.error=e.stack;report.passed=false;throw e;}
 finally{clearTimeout(bound);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');reports.push(report);await writeFile(`tests/fixtures/local-pdf-production-20261012/${mode}.log`,output);await writeFile('tests/fixtures/local-pdf-production-20261012/lifecycle.json',JSON.stringify(reports,null,2));}
}
console.log(JSON.stringify(reports));
