import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import VdocWorkspace from '../../components/editor/workspace';
import {bucket,bucketName,indexedDB,nativeTransactions} from './bucket';
import '../../app/globals.css';

const request = <T,>(r:IDBRequest<T>) => new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const terminal = (tx:IDBTransaction) => new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Aborted'));});
let fillerDB:IDBDatabase|undefined;
let filledBytes=0;
const keys:string[]=[];
const events:unknown[]=[];
const note=(event:unknown)=>events.push({at:new Date().toISOString(),event});
async function filler() {
  if (fillerDB) return fillerDB;
  const r=indexedDB.open('vdoc-qa-filler',1);r.onupgradeneeded=()=>r.result.createObjectStore('filler');
  fillerDB=await request(r);return fillerDB;
}
function QAControls() {
  const [report,setReport]=useState('8 MiB native bucket: '+bucketName);
  const [busy,setBusy]=useState(false);
  async function fill() {
    setBusy(true);const log:unknown[]=[];
    try {
      const db=await filler();
      for(let batch=0;batch<512;batch++) {
          const before=await bucket.estimate();
          const remaining=(before.quota||0)-(before.usage||0);
          const size=remaining>1024*1024+65536?1024*1024:remaining>65536?32768:4096;
          if(filledBytes+size>32*1024*1024){note({stopped:'32 MiB budget'});break;}
          const bytes=new Uint8Array(size);for(let i=0;i<size;i+=65536)crypto.getRandomValues(bytes.subarray(i,Math.min(size,i+65536)));
          const key='vdoc-qa-'+crypto.randomUUID();
          const tx=db.transaction('filler','readwrite',{durability:'strict'}),done=terminal(tx);
          try {tx.objectStore('filler').put(bytes,key);await done;keys.push(key);filledBytes+=size;const entry={key,size,filledBytes,before,after:await bucket.estimate()};log.push(entry);note(entry);}
          catch(error) {const entry={key,size,before,rejected:(error as Error).name,message:(error as Error).message};log.push(entry);note(entry);break;}
      }
      setReport(JSON.stringify({bucketName,filledBytes,keys:keys.length,estimate:await bucket.estimate(),log},null,2));
    } catch(error) {setReport(String(error));} finally {setBusy(false);}
  }
  async function release() {
    setBusy(true);
    try {const db=await filler();const releasedKeys=[...keys];const tx=db.transaction('filler','readwrite',{durability:'strict'}),done=terminal(tx);for(const key of keys)tx.objectStore('filler').delete(key);await done;keys.length=0;const result={bucketName,released:true,releasedKeys,remainingKeys:await request(db.transaction('filler').objectStore('filler').getAllKeys()),estimate:await bucket.estimate()};note(result);setReport(JSON.stringify(result,null,2));}
    catch(error){setReport(String(error));}finally{setBusy(false);}
  }
  function downloadReport() {
    const blob=new Blob([JSON.stringify({bucketName,userAgent:navigator.userAgent,filledBytes,keys,events,nativeTransactions,report},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='QA quota event report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function databaseBackup() {
    const db=await request(indexedDB.open('vdoc.local.v2'));
    try {
      const names=Array.from(db.objectStoreNames),tx=db.transaction(names,'readonly'),done=terminal(tx);
      const stores=Object.fromEntries(await Promise.all(names.map(async name=>[name,await request(tx.objectStore(name).getAll())])));await done;
      const blob=new Blob([JSON.stringify({bucketName,at:new Date().toISOString(),stores},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='QA quota database snapshot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }finally{db.close();}
  }
  async function storedBackup() {
    const id=new URLSearchParams(location.hash.slice(1)).get('document');if(!id){setReport('Open a QA document first.');return;}
    const r=indexedDB.open('vdoc.local.v2');const db=await request(r);
    try {
      const value=await request(db.transaction('documents').objectStore('documents').get(id));
      if(!value){setReport('No committed QA document for this ID.');return;}
      const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='QA quota last committed.vdoc.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      const result={bucketName,storedDocumentId:id,savedAt:value.savedAt,title:value.title,estimate:await bucket.estimate()};note(result);setReport(JSON.stringify(result,null,2));
    }finally{db.close();}
  }
  return <details style={{position:'fixed',right:12,bottom:40,zIndex:10000,width:420,background:'#fff',border:'2px solid #222',padding:12}}><summary>Isolated quota QA · 8 MiB</summary><p>Native bucket IndexedDB; normal VDoc storage logic. Filler stops at the first real refusal or 32 MiB. Only this page's filler keys are released.</p><button disabled={busy} onClick={()=>void fill()}>Fill QA bucket</button>{' '}<button disabled={busy||!keys.length} onClick={()=>void release()}>Release QA filler</button>{' '}<button disabled={busy} onClick={()=>void storedBackup()}>Download last committed QA document</button>{' '}<button onClick={downloadReport}>Download QA report</button>{' '}<button onClick={()=>void databaseBackup()}>Download QA database snapshot</button>{' '}<button disabled={busy||!!keys.length} onClick={()=>location.reload()}>Reload QA workspace</button><pre role="status" aria-label="Quota QA report" style={{whiteSpace:'pre-wrap',maxHeight:220,overflow:'auto'}}>{busy?'Working…':report}</pre></details>;
}
createRoot(document.getElementById('root')!).render(<><VdocWorkspace/><QAControls/></>);
