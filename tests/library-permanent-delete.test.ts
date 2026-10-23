import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const content = { type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'保留 العربية'}]}] };
beforeEach(()=>{localStorage.clear();globalThis.indexedDB=new IDBFactory();vi.resetModules();});
afterEach(()=>vi.restoreAllMocks());
async function setup() {
 const store=await import('../lib/infrastructure/persistence/document-store'), versionStore = await import('../lib/infrastructure/persistence/version-store'), idb = await import('../lib/infrastructure/persistence/indexed-db'),lib=await import('../lib/infrastructure/persistence/library-store');
 const a=await lib.createLibraryDocument({version:1,title:'Discard',content,savedAt:''},null);
 const va=await versionStore.saveVersion(a,'Discard checkpoint');
 const b=await lib.createLibraryDocument({version:1,title:'Keep',content,savedAt:''},null);
 const vb=await versionStore.saveVersion(b,'Keep checkpoint');
 const trash=await lib.updateLibraryItem(a.id,{trash:true});
 return {store, versionStore, idb,lib,a,b,va,vb,expected:trash.trash!};
}
async function all(idb:typeof import('../lib/infrastructure/persistence/indexed-db')) {
 const db=await idb.openDatabase(),names=Array.from(db.objectStoreNames),tx=db.transaction(names);
 return Object.fromEntries(await Promise.all(names.map(async name=>[name,await idb.requestResult(tx.objectStore(name).getAll())])));
}
it('atomically removes only the confirmed document, summary, metadata and its versions, preserving another active document',async()=>{
 const {store, idb,lib,a,b,expected,vb}=await setup();await lib.deleteTrashedDocument(a.id,expected);
 expect(await lib.listLibrary()).toHaveLength(1);expect(await store.openArchivedDocument(b.id)).toEqual(b);
 const data=await all(idb);expect(data.documents.map((d:{id:string})=>d.id)).toEqual([b.id]);expect(data.summaries.map((d:{id:string})=>d.id)).toEqual([b.id]);expect(data.libraryMetadata.map((d:{id:string})=>d.id)).toEqual([b.id]);expect(data.versions).toEqual([vb]);
 expect((await store.readSavedDocument()).data?.id).toBe(b.id);
});
it('clears the active pointer if it belongs to the deleted document',async()=>{
 const {store, idb,lib,a,expected}=await setup();const db=await idb.openDatabase(),tx=idb.writeTransaction(db,'settings'),done=idb.transactionDone(tx);tx.objectStore('settings').put(a.id,'active');await done;
 await lib.deleteTrashedDocument(a.id,expected);expect((await store.readSavedDocument()).data).toBeNull();
});
it.each(['restored','retrashed','wrong-group'] as const)('rejects stale confirmation after %s and preserves every store',async mode=>{
 const {idb,lib,a,expected}=await setup();
 if(mode!=='wrong-group')await lib.updateLibraryItem(a.id,{trash:false});
 if(mode==='retrashed')await lib.updateLibraryItem(a.id,{trash:true});
 if(mode==='wrong-group')expected.group='not-the-confirmed-operation';
 const before=await all(idb);await expect(lib.deleteTrashedDocument(a.id,expected)).rejects.toThrow('changed');expect(await all(idb)).toEqual(before);
});
it('rolls back earlier removals when a checkpoint deletion throws and allows a clean retry',async()=>{
 const {idb,lib,a,expected}=await setup(),before=await all(idb),original=IDBObjectStore.prototype.delete;
 const fail=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key){if(this.name==='versions')throw new DOMException('Delete denied','UnknownError');return original.call(this,key);});
 await expect(lib.deleteTrashedDocument(a.id,expected)).rejects.toThrow('Delete denied');expect(await all(idb)).toEqual(before);fail.mockRestore();await lib.deleteTrashedDocument(a.id,expected);expect(await lib.listLibrary()).toHaveLength(1);
});
it('rejects folder deletion and leaves its descendants untouched',async()=>{
 const {idb,lib}=await setup();const folder=await lib.createFolder('Folder',null);await lib.createLibraryDocument({version:1,title:'Child',content,savedAt:''},folder);const meta=await lib.updateLibraryItem(folder,{trash:true}),before=await all(idb);
 await expect(lib.deleteTrashedDocument(folder,meta.trash!)).rejects.toThrow('no longer exists');expect(await all(idb)).toEqual(before);
});
it('does not let a stale editor or checkpoint recreate a permanently deleted document',async()=>{
 const {store, versionStore, idb,lib,a,expected}=await setup();await lib.deleteTrashedDocument(a.id,expected);const before=await all(idb);
 await expect(store.saveDocument('Late edit',content,a.id)).rejects.toThrow('no longer exists');await expect(versionStore.saveVersion(a,'Late checkpoint')).rejects.toThrow('no longer exists');await expect(lib.deleteTrashedDocument(a.id,expected)).rejects.toThrow('no longer exists');expect(await all(idb)).toEqual(before);
});
