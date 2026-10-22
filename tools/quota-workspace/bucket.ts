// Test-only IndexedDB dependency, never included in the production build.
// No monkey patch, synthetic exceptions, Safari state, or default-bucket reads.
interface Bucket { indexedDB:IDBFactory; estimate():Promise<{usage?:number;quota?:number}> }
const manager = (navigator as Navigator & {storageBuckets?:{open(name:string,options:{quota:number}):Promise<Bucket>}}).storageBuckets;
if (!manager) throw new Error('This browser does not support isolated storage buckets.');
const url = new URL(location.href);
let name = url.searchParams.get('qaBucket');
if (!name) { name='vdoc-qa-'+crypto.randomUUID();url.searchParams.set('qaBucket',name);history.replaceState(null,'',url); }
if (!/^vdoc-qa-[0-9a-f-]{36}$/.test(name)) throw new Error('Invalid QA bucket name.');
export const bucketName = name;
export const bucket = await manager.open(name,{quota:8*1024*1024});
const initial = await bucket.estimate();
if (!initial.quota || initial.quota>8*1024*1024) throw new Error('The browser did not accept the bounded QA quota.');
export const indexedDB = bucket.indexedDB;
export const nativeTransactions:unknown[]=[];
export function observeNativeTransaction(tx:IDBTransaction) {
  const entry:{at:string;stores:string[];state:string;error?:{name:string;message:string}}={at:new Date().toISOString(),stores:Array.from(tx.objectStoreNames),state:'pending'};
  nativeTransactions.push(entry);
  tx.addEventListener('complete',()=>{entry.state='complete';});
  tx.addEventListener('abort',()=>{entry.state='abort';entry.error={name:tx.error?.name||'',message:tx.error?.message||''};});
  return tx;
}
