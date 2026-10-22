import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { STORAGE_KEY, parseDocument } from '../lib/editor/storage';
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep my document' }] }] };
beforeEach(async () => {
  // Isolate the database connection between tests; each test uses fresh IDs.
  localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules();
});
it('uses atomic local storage for large documents and prevents a late save from overwriting another document', async () => {
  const store = await import('../lib/editor/document-store');
  const first = await store.activateDocument({ version: 1, id: crypto.randomUUID(), title: 'First', content, savedAt: new Date().toISOString() });
  const large = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Large document. '.repeat(400000) }] }] };
  await store.saveDocument('First large', large, first.id);
  expect(JSON.stringify((await store.openArchivedDocument(first.id)).content).length).toBeGreaterThan(5_000_000);
  const second = await store.activateDocument({ ...first, id: crypto.randomUUID(), title: 'Second' });
  await expect(store.saveDocument('Stale first save', content, first.id)).rejects.toThrow('active document changed');
  expect((await store.readSavedDocument()).data!.id).toBe(second.id);
  expect((await store.openArchivedDocument(first.id)).title).toBe('First large');
  expect((await store.listDocuments()).some(doc => doc.id === first.id)).toBe(true);
});
it('round trips rich document backup content through IndexedDB', async () => {
  const store = await import('../lib/editor/document-store');
  const saved = await store.activateDocument({ version: 1, id: crypto.randomUUID(), title: 'Restore', content, savedAt: new Date().toISOString() });
  const restored = await store.openArchivedDocument(saved.id);
  expect(restored.title).toBe('Restore'); expect(restored.content.content![0].content![0]).toMatchObject({text:'Keep my document'});
});

it('migrates the original document and library without deleting the recovery source', async () => {
  const current = { version: 1, id: 'legacy-current', title: 'Original', content, savedAt: new Date().toISOString() };
  const archived = { ...current, id: 'legacy-archive', title: 'Archived' };
  const raw = JSON.stringify(current); localStorage.setItem(STORAGE_KEY, raw);
  localStorage.setItem('vdoc.library.v1', JSON.stringify([{ id: archived.id, title: archived.title, savedAt: archived.savedAt }]));
  localStorage.setItem('vdoc.archive.legacy-archive', JSON.stringify(archived));
  const store = await import('../lib/editor/document-store');
  expect((await store.readSavedDocument()).data!.title).toBe('Original');
  expect((await store.listDocuments()).map(d => d.title).sort()).toEqual(['Archived','Original']);
  await store.saveDocument('Edited original', content, 'legacy-current');
  expect((await store.readSavedDocument()).data!.title).toBe('Edited original');
  expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
});
it('preserves damaged legacy data and allows a separate imported document', async () => {
  localStorage.setItem(STORAGE_KEY, '{damaged');
  const store = await import('../lib/editor/document-store');
  expect((await store.readSavedDocument()).error).toBeDefined();
  await store.activateDocument({version:1,id:'recovered',title:'Recovered',content,savedAt:new Date().toISOString()});
  expect((await store.readSavedDocument()).data!.title).toBe('Recovered');
  expect(localStorage.getItem(STORAGE_KEY)).toBe('{damaged');
});
it('restores a saved version and preserves the work it replaces', async () => {
  const store = await import('../lib/editor/document-store');
  const original = await store.activateDocument({version:1,id:'version-test',title:'Original',content,savedAt:new Date().toISOString()});
  const version = await store.saveVersion(original, 'First draft');
  const changed = await store.saveDocument('Revised', {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'New work'}]}]}, original.id);
  const restored = await store.restoreVersion(version.key, changed);
  expect(restored.title).toBe('Original');
  expect(restored.content.content![0].content![0].text).toBe('Keep my document');
  const saved = await store.listVersions(original.id);
  expect(saved.find(v=>v.label==='Before restoring a version')!.document.title).toBe('Revised');
  await expect(store.restoreVersion(version.key, {...changed,id:'another-document'})).rejects.toThrow('current document');
});
it('keeps the newest 40 versions even when saves share the same millisecond', async()=>{
  const store=await import('../lib/editor/document-store');
  const document=await store.activateDocument({version:1,id:'retention-test',title:'Version retention',content,savedAt:new Date().toISOString()});
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
  try {
    for(let i=0;i<45;i++)await store.saveVersion({...document,title:`Revision ${i}`},`Revision ${i}`);
    const versions=await store.listVersions(document.id);
    expect(versions).toHaveLength(40);
    expect(versions.map(v=>v.label)).toEqual(Array.from({length:40},(_,i)=>`Revision ${44-i}`));
  } finally { vi.useRealTimers(); }
});
it('organizes existing documents without losing contents or folder membership on autosave', async () => {
  const store = await import('../lib/editor/document-store');
  const library = await import('../lib/editor/library-store');
  const doc = await store.activateDocument({version:1,id:'library-original',title:'Original',content,savedAt:new Date().toISOString()});
  const parent = await library.createFolder('Projects', null);
  const child = await library.createFolder('中国 العربية 日本語', parent);
  await library.updateLibraryItem(doc.id, {parentId:child, starred:true, title:'Renamed'});
  await store.saveDocument('Renamed', content, doc.id);
  expect((await library.listLibrary()).find(item=>item.id===doc.id)).toMatchObject({title:'Renamed',parentId:child,starred:true,kind:'document'});
  expect((await store.openArchivedDocument(doc.id)).content).toMatchObject(content);
  await expect(library.updateLibraryItem(parent, {parentId:child})).rejects.toThrow('subfolders');
  await expect(library.updateLibraryItem(parent, {parentId:parent})).rejects.toThrow('itself');
  await expect(library.updateLibraryItem(doc.id, {parentId:'missing'})).rejects.toThrow('unavailable');
  await expect(library.createFolder('   ', null)).rejects.toThrow('name');
  await library.updateLibraryItem(parent,{trash:true});
  expect((await library.listLibrary()).every(item=>Boolean(item.trashedAt))).toBe(true);
  await library.updateLibraryItem(parent,{trash:false});
  expect((await library.listLibrary()).every(item=>!item.trashedAt)).toBe(true);
});
it('copies rich content independently and restores trash to a valid destination', async () => {
  const store = await import('../lib/editor/document-store');
  const library = await import('../lib/editor/library-store');
  const folder = await library.createFolder('Archive', null);
  const doc = await store.activateDocument({version:1,id:'copy-original',title:'Original',content,savedAt:new Date().toISOString()});
  await library.updateLibraryItem(doc.id,{parentId:folder,starred:true});
  const copy = await library.copyLibraryDocument(doc.id);
  expect(copy.id).not.toBe(doc.id);
  expect((await library.listLibrary()).find(item=>item.id===copy.id)).toMatchObject({parentId:folder,starred:false,title:'Copy of Original'});
  await store.activateDocument(copy);
  await store.saveDocument('Copy changed',{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Only copy changed'}]}]},copy.id);
  expect((await store.openArchivedDocument(doc.id)).content.content![0].content![0].text).toBe('Keep my document');
  await library.updateLibraryItem(doc.id,{trash:true});
  await library.updateLibraryItem(copy.id,{trash:true});
  await library.updateLibraryItem(folder,{trash:true});
  await expect(library.copyLibraryDocument(doc.id)).rejects.toThrow('Restore');
  await library.updateLibraryItem(doc.id,{trash:false});
  expect((await library.listLibrary()).find(item=>item.id===doc.id)).toMatchObject({parentId:null,starred:true});
  expect((await library.listLibrary()).find(item=>item.id===doc.id)?.trashedAt).toBeUndefined();
  expect((await store.openArchivedDocument(doc.id)).content.content![0].content![0].text).toBe('Keep my document');
});
it('upgrades a version 2 database while retaining existing documents and versions', async () => {
  const request = indexedDB.open('vdoc.local.v2',2);
  await new Promise<void>((resolve,reject)=>{
    request.onupgradeneeded=()=>{const db=request.result; for(const name of ['documents','summaries'])db.createObjectStore(name,{keyPath:'id'});db.createObjectStore('settings');db.createObjectStore('versions',{keyPath:'key'}).createIndex('documentId','documentId');};
    request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
  });
  const oldDoc={version:1,id:'pre-upgrade',title:'Before upgrade',content,savedAt:new Date().toISOString()};
  const tx=request.result.transaction(['documents','summaries','versions'],'readwrite');
  tx.objectStore('documents').put(oldDoc);tx.objectStore('summaries').put({id:oldDoc.id,title:oldDoc.title,savedAt:oldDoc.savedAt});
  tx.objectStore('versions').put({key:'previous-version',documentId:oldDoc.id,document:oldDoc,label:'Before upgrade',createdAt:oldDoc.savedAt});
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});request.result.close();
  const store=await import('../lib/editor/document-store');const library=await import('../lib/editor/library-store');
  expect((await library.listLibrary())[0]).toMatchObject({id:'pre-upgrade',kind:'document',parentId:null,starred:false});
  expect((await store.listVersions(oldDoc.id))[0].label).toBe('Before upgrade');
  await library.createFolder('After upgrade',null);
  expect((await store.openArchivedDocument(oldDoc.id)).title).toBe('Before upgrade');
});

it('restores a folder subtree without reviving documents trashed earlier',async()=>{
  const store=await import('../lib/editor/document-store'); const library=await import('../lib/editor/library-store');
  const root=await library.createFolder('Root',null);const child=await library.createFolder('Child',root);
  for(const id of ['already-trashed','with-folder']) { await store.archiveDocument({version:1,id,title:id,content,savedAt:new Date().toISOString()});await library.updateLibraryItem(id,{parentId:child}); }
  await library.updateLibraryItem('already-trashed',{trash:true});
  await library.updateLibraryItem(root,{trash:true});
  await library.updateLibraryItem(root,{trash:false});
  const items=await library.listLibrary();
  expect(items.find(item=>item.id==='already-trashed')?.trashedAt).toBeTruthy();
  expect(items.find(item=>item.id==='with-folder')?.trashedAt).toBeUndefined();
  expect(items.find(item=>item.id==='with-folder')?.parentId).toBe(child);
  expect(items.find(item=>item.id===child)?.parentId).toBe(root);
});

it('opens an explicit saved document instead of the last active one without rewriting either document', async () => {
  const store = await import('../lib/editor/document-store');
  const first = await store.archiveDocument({ version: 1, id: 'link-first', title: 'First 中文', content, savedAt: '2026-01-01T00:00:00.000Z' });
  const second = await store.activateDocument({ ...first, id: 'last-active', title: 'Second' });
  expect(await store.readSavedDocument(first.id)).toEqual({ data: parseDocument(JSON.stringify(first)) });
  expect((await store.readSavedDocument()).data?.id).toBe(first.id);
  expect(await store.openArchivedDocument(first.id)).toEqual(parseDocument(JSON.stringify(first)));
  expect(await store.openArchivedDocument(second.id)).toEqual(parseDocument(JSON.stringify(second)));
  const db = await store.openDatabase();
  expect(await store.requestResult(db.transaction('documents').objectStore('documents').get(first.id))).toEqual(first);
  expect(await store.requestResult(db.transaction('documents').objectStore('documents').get(second.id))).toEqual(second);
  await store.saveDocument('First edited', content, first.id);
  expect((await store.openArchivedDocument(second.id)).title).toBe('Second');
});
it.each(['missing', ''])('does not replace the active document when the linked ID is unavailable: %j', async id => {
  const store = await import('../lib/editor/document-store');
  const active = await store.activateDocument({ version: 1, id: 'keep-active', title: 'Keep', content, savedAt: new Date().toISOString() });
  const result = await store.readSavedDocument(id);
  expect(result.data).toBeNull(); expect(result.error).toContain('not available in this browser');
  expect((await store.readSavedDocument()).data).toEqual(parseDocument(JSON.stringify(active)));
});
it('does not reopen or restore a trashed document through its old link', async () => {
  const store = await import('../lib/editor/document-store'); const library = await import('../lib/editor/library-store');
  const trashed = await store.archiveDocument({ version: 1, id: 'link-trash', title: 'Trash me', content, savedAt: new Date().toISOString() });
  const active = await store.activateDocument({ ...trashed, id: 'keep-active' });
  await library.updateLibraryItem(trashed.id, { trash: true });
  expect((await store.readSavedDocument(trashed.id)).error).toContain('in Trash');
  expect((await store.readSavedDocument()).data?.id).toBe(active.id);
  expect((await library.listLibrary()).find(item => item.id === trashed.id)?.trashedAt).toBeTruthy();
  await library.updateLibraryItem(trashed.id, { trash: false });
  expect((await store.readSavedDocument(trashed.id)).data).toEqual(parseDocument(JSON.stringify(trashed)));
});
it('preserves corrupt linked data and the previous active document', async () => {
  const store = await import('../lib/editor/document-store');
  const active = await store.activateDocument({ version: 1, id: 'healthy', title: 'Healthy', content, savedAt: new Date().toISOString() });
  const corrupt = { id: 'corrupt', version: 999, content: { type: 'unknown' } };
  const db = await store.openDatabase(); const tx = db.transaction('documents', 'readwrite'); const done = store.transactionDone(tx);
  tx.objectStore('documents').put(corrupt); await done;
  expect((await store.readSavedDocument('corrupt')).error).toBeTruthy();
  expect((await store.readSavedDocument()).data).toEqual(parseDocument(JSON.stringify(active)));
  expect(await store.requestResult(db.transaction('documents').objectStore('documents').get('corrupt'))).toEqual(corrupt);
});
it('rolls back linked activation if local storage cannot commit it', async () => {
  const store = await import('../lib/editor/document-store');
  const linked = await store.archiveDocument({ version: 1, id: 'linked', title: 'Linked', content, savedAt: new Date().toISOString() });
  const active = await store.activateDocument({ ...linked, id: 'previous' });
  // Finish migration before injecting a failure into the activation transaction.
  await store.readSavedDocument();
  const db = await store.openDatabase(); const original = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementation(((names: string | string[], mode?: IDBTransactionMode) => {
    const tx = original(names, mode);
    if (mode === 'readwrite' && Array.isArray(names) && names.includes('libraryMetadata')) {
      tx.addEventListener('success', event => {
        const source = (event.target as IDBRequest).source;
        if (source instanceof IDBObjectStore && source.name === 'settings') tx.abort();
      }, true);
    }
    return tx;
  }) as typeof db.transaction);
  try { expect((await store.readSavedDocument(linked.id)).error).toBeTruthy(); } finally { spy.mockRestore(); }
  expect((await store.readSavedDocument()).data).toEqual(parseDocument(JSON.stringify(active)));
  expect(await store.openArchivedDocument(linked.id)).toEqual(parseDocument(JSON.stringify(linked)));
});
it('resolves a document link after migrating the legacy archive', async () => {
  const current = { version: 1, id: 'legacy-current', title: 'Original', content, savedAt: new Date().toISOString() };
  const archived = { ...current, id: 'legacy-linked', title: 'Linked legacy' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  localStorage.setItem('vdoc.library.v1', JSON.stringify([{ id: archived.id, title: archived.title, savedAt: archived.savedAt }]));
  localStorage.setItem(`vdoc.archive.${archived.id}`, JSON.stringify(archived));
  const store = await import('../lib/editor/document-store');
  expect((await store.readSavedDocument(archived.id)).data).toEqual(parseDocument(JSON.stringify(archived)));
  expect((await store.readSavedDocument()).data?.id).toBe(archived.id);
  expect(await store.openArchivedDocument(current.id)).toEqual(parseDocument(JSON.stringify(current)));
});
it('selects the latest stored document by ID without rewriting document or summary records',async()=>{
 const store=await import('../lib/editor/document-store'),library=await import('../lib/editor/library-store');
 const original=await store.archiveDocument({version:1,id:'select-existing',title:'Old title',content,savedAt:'2026-01-01T00:00:00.000Z'});
 await store.activateDocument({...original,id:'current'});
 await library.updateLibraryItem(original.id,{title:'Latest title'});
 const latest=await store.openArchivedDocument(original.id),summaries=await store.listDocuments();
 const put=vi.spyOn(IDBObjectStore.prototype,'put');
 try {
  expect(await store.selectDocument(original.id)).toEqual(latest);
  expect(put).toHaveBeenCalledExactlyOnceWith(original.id,'active');
 } finally {put.mockRestore();}
 expect(await store.listDocuments()).toEqual(summaries);
 expect((await store.readSavedDocument()).data).toEqual(latest);
});
it('does not select a document trashed since its library entry was displayed',async()=>{
 const store=await import('../lib/editor/document-store'),library=await import('../lib/editor/library-store');
 const existing=await store.archiveDocument({version:1,id:'select-trash',title:'Existing',content,savedAt:new Date().toISOString()});
 const current=await store.activateDocument({...existing,id:'select-current'});
 await library.updateLibraryItem(existing.id,{trash:true});
 await expect(store.selectDocument(existing.id)).rejects.toThrow('in Trash');
 expect((await store.readSavedDocument()).data!.id).toBe(current.id);
 expect((await library.listLibrary()).find(item=>item.id===existing.id)?.trashedAt).toBeTruthy();
});
it('rolls back selection failure and leaves both documents unchanged',async()=>{
 const store=await import('../lib/editor/document-store');
 const existing=await store.archiveDocument({version:1,id:'select-target',title:'Target',content,savedAt:new Date().toISOString()});
 const current=await store.activateDocument({...existing,id:'select-current'});
 const put=IDBObjectStore.prototype.put;
 const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value,key){
  const request=key===undefined?put.call(this,value):put.call(this,value,key);
  if(this.name==='settings'&&value===existing.id)request.addEventListener('success',()=>this.transaction.abort());return request;
 });
 try {await expect(store.selectDocument(existing.id)).rejects.toThrow();} finally {fail.mockRestore();}
 expect((await store.readSavedDocument()).data!.id).toBe(current.id);
 expect(await store.openArchivedDocument(existing.id)).toEqual(parseDocument(JSON.stringify(existing)));
 expect(await store.listDocuments()).toHaveLength(2);
});
