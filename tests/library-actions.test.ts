import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {LibraryHome} from '../components/editor/library-home';
const calls=vi.hoisted(()=>({create:vi.fn(),folder:vi.fn(),copy:vi.fn(),remove:vi.fn(),activate:vi.fn(),select:vi.fn(),update:vi.fn(),success:vi.fn(),list:vi.fn(),error:vi.fn(),info:vi.fn(),word:vi.fn()}));
vi.mock('../lib/infrastructure/persistence/document-store',()=>({activateDocument:calls.activate,selectDocument:calls.select}));
vi.mock('../lib/infrastructure/persistence/library-store',()=>({listLibrary:calls.list,createLibraryDocument:calls.create,createFolder:calls.folder,updateLibraryItem:calls.update,copyLibraryDocument:calls.copy,deleteTrashedDocument:calls.remove}));
vi.mock('../lib/infrastructure/word/word',()=>({importWord:calls.word}));
vi.mock('sonner',()=>({Toaster:()=>null,toast:{error:calls.error,info:calls.info,success:calls.success}}));
let root:Root,mount:HTMLDivElement,onOpen:ReturnType<typeof vi.fn>;
const newButton=()=>Array.from(mount.querySelectorAll('button')).find(button=>button.textContent?.includes('New document'))!;
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);sessionStorage.clear();calls.create.mockReset().mockImplementation(async value=>value);calls.folder.mockReset().mockResolvedValue('new-folder');calls.activate.mockReset().mockImplementation(async value=>value);calls.list.mockReset().mockResolvedValue([]);calls.select.mockReset();calls.copy.mockReset().mockResolvedValue({id:"copied"});calls.update.mockReset();calls.success.mockReset();calls.error.mockReset();calls.info.mockReset();calls.word.mockReset().mockResolvedValue({content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Imported 中文 العربية'}]}]},warnings:['Custom tabs need review','Static checkboxes need review']});
 calls.remove.mockReset().mockResolvedValue(undefined);
 mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);onOpen=vi.fn();await act(async()=>root.render(createElement(LibraryHome,{onOpen})));
});
afterEach(()=>{act(()=>root.unmount());mount.remove();vi.unstubAllGlobals();});
it('creates just one document when New document is triggered twice in the same event batch',async()=>{
 const button=newButton();await act(async()=>{button.click();button.click();});expect(calls.create).toHaveBeenCalledOnce();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).toHaveBeenCalledOnce();
});
it('does not allow the blank-document shortcut to start a second creation while a save is pending',async()=>{
 let finish!:(value:unknown)=>void;calls.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>{newButton().click();});
 const blank=Array.from(mount.querySelectorAll('button')).find(button=>button.textContent?.includes('Blank document'))!;expect(blank.disabled).toBe(true);await act(async()=>{blank.click();});expect(calls.create).toHaveBeenCalledOnce();
 await act(async()=>{finish(calls.create.mock.calls[0][0]);});expect(onOpen).toHaveBeenCalledOnce();
});
it('allows retry after a failed creation and does not open a document on failure',async()=>{
 calls.create.mockRejectedValueOnce(new Error('Storage unavailable'));await act(async()=>{newButton().click();});expect(calls.error).toHaveBeenCalledWith('Storage unavailable',expect.any(Object));expect(onOpen).not.toHaveBeenCalled();expect(newButton().disabled).toBe(false);
 await act(async()=>{newButton().click();});expect(onOpen).toHaveBeenCalledOnce();
});
it.each(['error','dom'] as const)('keeps an actionable persistent quota error when the %s exception has no message',async kind=>{
 calls.create.mockRejectedValueOnce(kind==='dom'?new DOMException('', 'QuotaExceededError'):Object.assign(new Error(''),{name:'QuotaExceededError'}));
 await act(async()=>newButton().click());
 expect(mount.querySelector('[role="alert"]')?.textContent).toContain('Local storage is full.');
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Download a backup'),expect.any(Object));
 expect(onOpen).not.toHaveBeenCalled();expect(newButton().disabled).toBe(false);
 await act(async()=>newButton().click());expect(onOpen).toHaveBeenCalledOnce();
});
it('does not reopen a new document after leaving the library while its save is pending',async()=>{
 let finish!:(value:unknown)=>void;calls.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>newButton().click());act(()=>root.unmount());
 await act(async()=>finish(calls.create.mock.calls[0][0]));expect(onOpen).not.toHaveBeenCalled();
});

async function chooseWord() {
 const input=mount.querySelector('input[type="file"]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'Review.docx',size:10,arrayBuffer:async()=>new ArrayBuffer(10)}]});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
}
it('shows all Word notices only after activation and opening succeed',async()=>{
 let finish!:(value:unknown)=>void;calls.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await chooseWord();expect(calls.info).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(calls.create.mock.calls[0][0]).not.toHaveProperty('warnings');
 await act(async()=>finish(calls.create.mock.calls[0][0]));
 expect(calls.info).toHaveBeenCalledOnce();expect(onOpen.mock.invocationCallOrder[0]).toBeLessThan(calls.info.mock.invocationCallOrder[0]);
 const html=renderToStaticMarkup(calls.info.mock.calls[0][1].description);expect(html).toContain('Custom tabs need review');expect(html).toContain('Static checkboxes need review');
});
it.each(['word','create'] as const)('never claims import success when %s fails and allows retry',async stage=>{
 calls[stage].mockRejectedValueOnce(new Error('Storage full'));await chooseWord();
 expect(onOpen).not.toHaveBeenCalled();expect(calls.info).not.toHaveBeenCalled();expect(calls.error).toHaveBeenCalledWith('Storage full',expect.any(Object));
 await chooseWord();expect(onOpen).toHaveBeenCalledOnce();expect(calls.info).toHaveBeenCalledOnce();
});
it('does not create a document from a conversion that finishes after leaving the library',async()=>{
 let finish!:(value:unknown)=>void;calls.word.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await chooseWord();act(()=>root.unmount());
 await act(async()=>finish({content:{type:'doc',content:[{type:'paragraph'}]},warnings:['Late warning']}));
 expect(calls.create).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();expect(calls.info).not.toHaveBeenCalled();
});
it('does not show a late conversion failure after leaving the library',async()=>{
 let fail!:(error:Error)=>void;calls.word.mockImplementation(()=>new Promise((_,reject)=>{fail=reject;}));await chooseWord();act(()=>root.unmount());
 await act(async()=>fail(new Error('Late conversion failure')));expect(calls.error).not.toHaveBeenCalled();
});
it('does not reopen or notify after activation finishes on an unmounted library',async()=>{
 let finish!:(value:unknown)=>void;calls.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await chooseWord();act(()=>root.unmount());
 await act(async()=>finish(calls.create.mock.calls[0][0]));expect(onOpen).not.toHaveBeenCalled();expect(calls.info).not.toHaveBeenCalled();
});
it('accepts just one Word import while conversion is pending',async()=>{
 let finish!:(value:unknown)=>void;calls.word.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await chooseWord();await chooseWord();expect(calls.word).toHaveBeenCalledOnce();
 await act(async()=>finish({content:{type:'doc',content:[{type:'paragraph'}]},warnings:[]}));expect(calls.create).toHaveBeenCalledOnce();expect(onOpen).toHaveBeenCalledOnce();
});
it('rejects corrupt backup bytes before adding to the library and allows a valid retry',async()=>{
 const raw=JSON.stringify({version:1,title:'Backup',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'@中文 العربية'}]}]}});
 const bytes=new TextEncoder().encode(raw);bytes[bytes.indexOf(0x40)]=0xff;
 const input=mount.querySelector<HTMLInputElement>('input[type="file"]')!;
 const pick=async(data:Uint8Array<ArrayBuffer>)=>{
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'Restore.vdoc.json',size:data.length,arrayBuffer:async()=>data.buffer}]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 };
 await pick(bytes);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('invalid UTF-8'),expect.any(Object));
 expect(calls.create).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();expect(input.disabled).toBe(false);
 await pick(new TextEncoder().encode(raw));expect(calls.create).toHaveBeenCalledOnce();expect(onOpen).toHaveBeenCalledOnce();
 expect(onOpen.mock.calls[0][0].content.content[0].content[0].text).toBe('@中文 العربية');
});
async function existingDocument() {
 calls.list.mockResolvedValue([{id:'existing',title:'Existing',kind:'document',parentId:null,starred:false,savedAt:'2026-10-05T12:00:00.000Z'}]);
 await act(async()=>root.render(createElement(LibraryHome,{key:'existing-library',onOpen})));
 return mount.querySelector<HTMLButtonElement>('[aria-label="Open document: Existing"]')!;
}
it('selects an existing document by ID once without writing a stale snapshot',async()=>{
 const button=await existingDocument();let finish!:(value:unknown)=>void;calls.select.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>{button.click();button.click();});expect(calls.select).toHaveBeenCalledExactlyOnceWith('existing');expect(onOpen).not.toHaveBeenCalled();
 const latest={id:'existing',title:'Latest title',content:{type:'doc',content:[{type:'paragraph'}]}};
 await act(async()=>finish(latest));expect(onOpen).toHaveBeenCalledExactlyOnceWith(latest);
 expect(calls.activate).not.toHaveBeenCalled();expect(calls.create).not.toHaveBeenCalled();
});
it('keeps the library usable after an existing document fails to open and permits retry',async()=>{
 const button=await existingDocument();calls.select.mockRejectedValueOnce(new Error('This document is in Trash.')).mockResolvedValueOnce({id:'existing'});
 await act(async()=>button.click());expect(onOpen).not.toHaveBeenCalled();expect(button.disabled).toBe(false);
 expect(calls.error).toHaveBeenCalledWith('This document is in Trash.',expect.any(Object));
 await act(async()=>button.click());expect(onOpen).toHaveBeenCalledOnce();
});
it('does not reopen a document when its selection finishes after leaving the library',async()=>{
 const button=await existingDocument();let finish!:(value:unknown)=>void;calls.select.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>button.click());act(()=>root.unmount());await act(async()=>finish({id:'existing'}));
 expect(onOpen).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();
});
async function moveExistingToTrash() {
 await existingDocument();
 await act(async()=>mount.querySelector('[aria-label="Actions for Existing"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 const move=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent==='Move to Trash')!;
 await act(async()=>move.click());
}
it('binds the Undo toast to the committed trash operation and reports a stale undo without success',async()=>{
 let finish!:(value:unknown)=>void;calls.update.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await moveExistingToTrash();expect(calls.success).not.toHaveBeenCalled();
 await act(async()=>finish({id:'existing',trash:{at:'2026-10-10T12:00:00Z',group:'committed-group'}}));
 const undo=calls.success.mock.calls[0][1].action;expect(undo.label).toBe('Undo');
 calls.update.mockRejectedValueOnce(new Error('This item changed after it was moved to Trash.'));
 await act(async()=>undo.onClick());
 expect(calls.update).toHaveBeenLastCalledWith('existing',{trash:false,expectedTrashGroup:'committed-group'});
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('changed'),expect.any(Object));expect(calls.success).toHaveBeenCalledOnce();
});
it('does not display a late Undo toast after leaving the library',async()=>{
 let finish!:(value:unknown)=>void;calls.update.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await moveExistingToTrash();act(()=>root.unmount());await act(async()=>finish({id:'existing',trash:{at:'2026-10-10T12:00:00Z',group:'committed-group'}}));
 expect(calls.success).not.toHaveBeenCalled();
});
it('keeps the rename dialog and entered title after failure, then permits retry',async()=>{
 await existingDocument();
 await act(async()=>mount.querySelector('[aria-label="Actions for Existing"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 await act(async()=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent==='Rename')!.click());
 const input=document.querySelector<HTMLInputElement>('[aria-label="New name"]')!;
 await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'New 中文 العربية');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 calls.update.mockRejectedValueOnce(new Error('The local document no longer exists.'));
 const submit=()=>document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await act(async()=>{submit();});
 expect(calls.update).toHaveBeenLastCalledWith('existing',{title:'New 中文 العربية'});
 expect(input.isConnected).toBe(true);expect(input.value).toBe('New 中文 العربية');
 expect(document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!.disabled).toBe(false);
 expect(calls.error).toHaveBeenCalledWith('The local document no longer exists.',expect.any(Object));
 expect(onOpen).not.toHaveBeenCalled();
 calls.update.mockResolvedValueOnce({id:'existing'});
 await act(async()=>{submit();});
 expect(calls.update).toHaveBeenCalledTimes(2);expect(document.querySelector('[role="dialog"]')).toBeNull();
});

const retryLoading=()=>Array.from(mount.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent==='Retry loading');

it.each([
 ['recent', ['doc']], ['files', ['doc', 'folder']], ['starred', ['folder']], ['trash', ['discarded']],
] as const)('keeps %s search within its scope and matches canonically equivalent text', async (scope, expected) => {
 const base = {parentId:null, starred:false, savedAt:'2026-10-09T00:00:00.000Z'};
 calls.list.mockResolvedValue([
  {...base,id:'folder',title:'Café folder 中文',kind:'folder',starred:true},
  {...base,id:'doc',title:'Café doc العربية',kind:'document',parentId:'folder'},
  {...base,id:'discarded',title:'Café discarded 日本語',kind:'document',trash:{at:'2026-10-09T00:00:00.000Z'}},
 ]);
 sessionStorage.setItem('vdoc.library.view', JSON.stringify({scope,parentId:null,query:'',sort:'name',view:'grid'}));
 await act(async () => root.render(createElement(LibraryHome,{key:`search-${scope}`,onOpen})));
 const input=mount.querySelector<HTMLInputElement>('[aria-label="Search documents and folders"]')!;
 await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'cafe\u0301');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 const titles=Array.from(mount.querySelectorAll('.library-item strong'),node=>node.textContent);
 const names={folder:'Café folder 中文',doc:'Café doc العربية',discarded:'Café discarded 日本語'};
 expect(titles.sort()).toEqual(expected.map(id=>names[id]).sort());
 expect(calls.update).not.toHaveBeenCalled();expect(calls.select).not.toHaveBeenCalled();
});

it.each(['folder','rename','move'] as const)('shows %s errors inside the active dialog and clears them for a new action', async kind => {
 await existingDocument();
 if(kind==='folder') await act(async()=>Array.from(mount.querySelectorAll('button')).find(button=>button.textContent==='New folder')!.click());
 else {
  await act(async()=>mount.querySelector('[aria-label="Actions for Existing"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  await act(async()=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent===(kind==='rename'?'Rename':'Move to folder'))!.click());
 }
 const dialog=document.querySelector('[role="dialog"]')!;
 const input=dialog.querySelector('input');
 if(input) await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Draft 中文 العربية');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 });
 const mutation=kind==='folder'?calls.folder:calls.update;
 mutation.mockRejectedValueOnce(new Error('Temporary storage failure. Try again.'));
 await act(async()=>dialog.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Temporary storage failure. Try again.');
 expect(mount.querySelector('.library-error')).toBeNull();
 if(input) expect(input.value).toBe('Draft 中文 العربية');
 expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
 expect(mutation).toHaveBeenCalledOnce();expect(onOpen).not.toHaveBeenCalled();
 await act(async()=>Array.from(dialog.querySelectorAll('button')).find(button=>button.textContent==='Cancel')!.click());
 await act(async()=>Array.from(mount.querySelectorAll('button')).find(button=>button.textContent==='New folder')!.click());
 expect(document.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
 expect(mutation).toHaveBeenCalledOnce();
});

async function copyWithRefreshFailure() {
 await existingDocument();
 await act(async()=>mount.querySelector('[aria-label="Actions for Existing"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 calls.list.mockRejectedValueOnce(new Error('Read unavailable'));
 await act(async()=>Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent==='Make a copy')!.click());
}
it('distinguishes a committed copy from a failed list refresh and retries only the read',async()=>{
 await copyWithRefreshFailure();
 expect(calls.copy).toHaveBeenCalledExactlyOnceWith('existing');
 expect(calls.success).toHaveBeenCalledWith('Copy created');expect(calls.error).not.toHaveBeenCalled();
 expect(mount.querySelector('[role="alert"]')?.textContent).toContain('saved');
 expect(newButton().disabled).toBe(true);
 expect(mount.querySelector<HTMLButtonElement>('[aria-label="Actions for Existing"]')!.disabled).toBe(true);
 expect(mount.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
 calls.list.mockResolvedValue([{id:'copied',title:'Copy of Existing',kind:'document',parentId:null,starred:false,savedAt:'2026-10-05T12:00:00.000Z'}]);
 await act(async()=>retryLoading()!.click());
 expect(mount.querySelector('[aria-label="Open document: Copy of Existing"]')).not.toBeNull();
 expect(mount.querySelector('[role="alert"]')).toBeNull();expect(newButton().disabled).toBe(false);
 expect(calls.copy).toHaveBeenCalledOnce();expect(calls.create).not.toHaveBeenCalled();
});
it('serializes list retries and leaves stale file actions unavailable until success',async()=>{
 await copyWithRefreshFailure();let finish!:(value:unknown)=>void;
 calls.list.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const count=calls.list.mock.calls.length;
 const button=retryLoading()!;await act(async()=>{button.click();button.click();});
 expect(calls.list).toHaveBeenCalledTimes(count+1);expect(button.disabled).toBe(true);
 expect(newButton().disabled).toBe(true);expect(calls.copy).toHaveBeenCalledOnce();
 await act(async()=>finish([]));expect(retryLoading()).toBeUndefined();expect(newButton().disabled).toBe(false);
});
it('retains the saved-change explanation after a retry fails and permits another read',async()=>{
 await copyWithRefreshFailure();calls.list.mockRejectedValueOnce(new Error('Still unavailable'));
 await act(async()=>retryLoading()!.click());
 expect(mount.querySelector('[role="alert"]')?.textContent).toContain('saved');expect(retryLoading()!.disabled).toBe(false);
 expect(newButton().disabled).toBe(true);expect(calls.error).not.toHaveBeenCalled();
 await act(async()=>retryLoading()!.click());expect(retryLoading()).toBeUndefined();expect(calls.copy).toHaveBeenCalledOnce();
});
it('recovers an initial library read failure without losing the selected folder',async()=>{
 sessionStorage.setItem('vdoc.library.view',JSON.stringify({scope:'files',parentId:'folder',query:'',sort:'modified',view:'grid'}));
 calls.list.mockRejectedValueOnce(new Error('Read unavailable'));
 await act(async()=>root.render(createElement(LibraryHome,{key:'initial-failure',onOpen})));
 expect(retryLoading()).toBeDefined();expect(newButton().disabled).toBe(true);
 calls.list.mockResolvedValue([{id:'folder',title:'Projects',kind:'folder',parentId:null,starred:false,savedAt:'2026-10-05T12:00:00.000Z'},{id:'inside',title:'Inside',kind:'document',parentId:'folder',starred:false,savedAt:'2026-10-05T12:00:00.000Z'}]);
 await act(async()=>retryLoading()!.click());
 expect(mount.querySelector('h2')?.textContent).toBe('Projects');expect(mount.querySelector('[aria-label="Open document: Inside"]')).not.toBeNull();
 expect(calls.create).not.toHaveBeenCalled();expect(calls.copy).not.toHaveBeenCalled();
});
it('does not reopen or notify when a read retry finishes after leaving the library',async()=>{
 await copyWithRefreshFailure();let fail!:(reason:Error)=>void;
 calls.list.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));
 await act(async()=>retryLoading()!.click());act(()=>root.unmount());
 await act(async()=>fail(new Error('Late read failure')));
 expect(onOpen).not.toHaveBeenCalled();expect(calls.error).not.toHaveBeenCalled();expect(calls.copy).toHaveBeenCalledOnce();
});
it('blocks an earlier Undo callback until the failed list refresh recovers',async()=>{
 let finish!:(value:unknown)=>void;calls.update.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await moveExistingToTrash();calls.list.mockRejectedValueOnce(new Error('Read unavailable'));
 await act(async()=>finish({id:'existing',trash:{at:'2026-10-10T12:00:00Z',group:'committed-group'}}));
 const undo=calls.success.mock.calls[0][1].action;
 await act(async()=>undo.onClick());expect(calls.update).toHaveBeenCalledOnce();
 await act(async()=>retryLoading()!.click());
 await act(async()=>undo.onClick());expect(calls.update).toHaveBeenCalledTimes(2);
 expect(calls.update).toHaveBeenLastCalledWith('existing',{trash:false,expectedTrashGroup:'committed-group'});
});

async function confirmTrashDelete() {
 sessionStorage.setItem('vdoc.library.view',JSON.stringify({scope:'trash',parentId:null,query:'',sort:'modified',view:'grid'}));
 calls.list.mockResolvedValue([{id:'discarded',title:'Discard me',kind:'document',parentId:null,starred:false,savedAt:'2026-10-10T12:00:00Z',trash:{at:'2026-10-10T12:01:00Z',group:'confirmed-group'}}]);
 await act(async()=>root.render(createElement(LibraryHome,{key:'trash-library',onOpen})));
 await act(async()=>mount.querySelector('[aria-label="Actions for Discard me"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
 const action=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(n=>n.textContent==='Delete permanently')!;await act(async()=>action.click());
 return document.querySelector('[role="dialog"]')!;
}
it('requires explicit confirmation, names the document and defaults focus to Cancel',async()=>{
 const dialog=await confirmTrashDelete();expect(calls.remove).not.toHaveBeenCalled();expect(dialog.textContent).toContain('Discard me');expect(dialog.textContent).toContain('cannot be undone');expect(document.activeElement?.textContent).toBe('Cancel');
 await act(async()=>Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='Cancel')!.click());expect(calls.remove).not.toHaveBeenCalled();
});
it('binds deletion to the confirmed Trash state and prevents double submission',async()=>{
 const dialog=await confirmTrashDelete();let finish!:()=>void;calls.remove.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const button=Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='Delete permanently')!;
 await act(async()=>{button.click();button.click();});expect(calls.remove).toHaveBeenCalledExactlyOnceWith('discarded',{at:'2026-10-10T12:01:00Z',group:'confirmed-group'});expect(calls.success).not.toHaveBeenCalled();
 await act(async()=>finish());expect(calls.success).toHaveBeenCalledWith('Document permanently deleted');
});
it('keeps a failed deletion confirmation open with an error and no success notification',async()=>{
 const dialog=await confirmTrashDelete();calls.remove.mockRejectedValueOnce(new Error('This document changed since you opened Trash.'));const button=Array.from(dialog.querySelectorAll('button')).find(b=>b.textContent==='Delete permanently')!;
 await act(async()=>button.click());expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('changed');expect(button.disabled).toBe(false);expect(calls.success).not.toHaveBeenCalled();
});
