import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {parseDocument} from '../lib/infrastructure/persistence/storage';

beforeEach(()=>{localStorage.clear();globalThis.indexedDB=new IDBFactory();vi.resetModules();});
afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const store=await import('../lib/infrastructure/persistence/document-store');
 const original=await store.activateDocument({...parseDocument(JSON.stringify({version:1,title:'Before',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Committed 中文 👩‍💻'}]}]}})),id:'sync-failure-qa'});
 await store.readSavedDocument();
 return {store,original};
}
function failPut(name:string){
 const put=IDBObjectStore.prototype.put;const failure=new DOMException('QA simulated quota rejection','QuotaExceededError');
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){if(this.name===name)throw failure;return key===undefined?put.call(this,value):put.call(this,value,key);});
 return {spy,failure};
}
it.each(['archiveDocument','activateDocument'] as const)('rolls back earlier writes if %s throws synchronously during the summary write',async method=>{
 const {store,original}=await fixture();const replacement={...original,title:'Do not partially commit'};const {spy,failure}=failPut('summaries');
 await expect(store[method](replacement)).rejects.toBe(failure);spy.mockRestore();
 expect(await store.openArchivedDocument(original.id)).toEqual(original);expect((await store.readSavedDocument()).data).toEqual(original);expect(await store.listDocuments()).toEqual([{id:original.id,title:original.title,savedAt:original.savedAt}]);
 await store[method](replacement);expect((await store.openArchivedDocument(original.id)).title).toBe(replacement.title);
});
it('leaves neither an orphan document nor a summary when activation fails on its last write',async()=>{
 const {store,original}=await fixture();const replacement={...original,id:'new-failed-document',title:'New'};const {spy,failure}=failPut('settings');
 await expect(store.activateDocument(replacement)).rejects.toBe(failure);spy.mockRestore();
 await expect(store.openArchivedDocument(replacement.id)).rejects.toThrow();expect((await store.readSavedDocument()).data).toEqual(original);expect(await store.listDocuments()).toHaveLength(1);
 await store.activateDocument(replacement);expect((await store.readSavedDocument()).data?.id).toBe(replacement.id);
});
it.each(['documents','summaries','settings'])('rejects autosave with its original error and rolls back when %s.put throws synchronously',async target=>{
 const {store,original}=await fixture();const {spy,failure}=failPut(target);
 await expect(store.saveDocument('Unsaved title',original.content,original.id)).rejects.toBe(failure);spy.mockRestore();
 expect(await store.openArchivedDocument(original.id)).toEqual(original);expect((await store.readSavedDocument()).data).toEqual(original);
 await store.saveDocument('Retried',original.content,original.id);expect((await store.readSavedDocument()).data?.title).toBe('Retried');
});
it('retains existing versions and the quota error when saving a version throws synchronously',async()=>{
 const {store,original}=await fixture();await store.saveVersion(original,'Keep');const before=await store.listVersions(original.id);const {spy,failure}=failPut('versions');
 await expect(store.saveVersion(original,'Failed')).rejects.toBe(failure);spy.mockRestore();expect(await store.listVersions(original.id)).toEqual(before);
 await store.saveVersion(original,'Retried');expect(await store.listVersions(original.id)).toHaveLength(2);
});
it('rolls back the new version and keeps all 40 old versions if retention pruning throws',async()=>{
 const {store,original}=await fixture();for(let i=0;i<40;i++)await store.saveVersion(original,`Keep ${i}`);const before=await store.listVersions(original.id);
 const remove=IDBObjectStore.prototype.delete;const failure=new DOMException('QA pruning failed','UnknownError');
 const spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key){if(this.name==='versions')throw failure;return remove.call(this,key);});
 await expect(store.saveVersion(original,'Not committed')).rejects.toBe(failure);spy.mockRestore();expect(await store.listVersions(original.id)).toEqual(before);
 await store.saveVersion(original,'Retried');const after=await store.listVersions(original.id);expect(after).toHaveLength(40);expect(after[0].label).toBe('Retried');expect(after.slice(1)).toEqual(before.slice(0,39));
});
it('keeps the complete failed draft available for backup and retries it without losing committed data',async()=>{
 const {Editor}=await import('@tiptap/core');const {createExtensions}=await import('../lib/editor/extensions');
 const {startAutosave}=await import('../lib/composition/autosave');const {store,original}=await fixture();
 const editor=new Editor({extensions:createExtensions(),content:original.content});await new Promise(r=>setTimeout(r,0));
 const report=vi.fn();const controller=startAutosave(editor,original.id,{getTitle:()=> 'Latest draft',blocked:{current:false},report});
 try {
  editor.commands.insertContent('Unsaved العربية 👩‍💻 ');const draft=editor.getJSON();const {spy}=failPut('summaries');await controller.flush();spy.mockRestore();
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.',expect.stringContaining('QA simulated quota rejection'));
  expect(editor.getJSON()).toEqual(draft);expect(await store.openArchivedDocument(original.id)).toEqual(original);
  const backup=parseDocument(JSON.stringify({version:1,title:'Latest draft',content:editor.getJSON()}));expect(backup.content).toEqual(draft);
  await controller.flush();expect(report).toHaveBeenLastCalledWith('Saved locally','');expect((await store.readSavedDocument()).data).toMatchObject({title:'Latest draft',content:draft});
 } finally {controller.dispose();editor.destroy();}
});
