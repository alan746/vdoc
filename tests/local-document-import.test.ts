import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement,Fragment} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {Editor} from '@tiptap/core';
import {createExtensions} from '../lib/editor/extensions';
import {LocalDocuments} from '../components/editor/local-documents';
import {BackToDocuments} from '../components/editor/back-to-documents';
import {documentNavigation} from '../lib/usecases/document-navigation';
const calls=vi.hoisted(()=>({save:vi.fn(),activate:vi.fn(),error:vi.fn(),info:vi.fn(),word:vi.fn(),list:vi.fn(),open:vi.fn()}));
vi.mock('../lib/infrastructure/persistence/document-store',()=>({saveDocument:calls.save,activateDocument:calls.activate,selectDocument:calls.open}));
vi.mock('../lib/infrastructure/persistence/library-store',()=>({listLibrary:calls.list}));
vi.mock('../lib/infrastructure/word/word',()=>({importWord:calls.word}));
vi.mock('sonner',()=>({toast:{error:calls.error,info:calls.info}}));
let root:Root,editor:Editor,onOpen:ReturnType<typeof vi.fn>,mount:HTMLDivElement;
const raw=JSON.stringify({version:1,id:'same-as-current',title:'Imported backup',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Restored 中文 العربية'}]}]}});
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);calls.save.mockReset().mockResolvedValue({});calls.activate.mockReset().mockImplementation(async value=>value);calls.error.mockReset();calls.info.mockReset();calls.word.mockReset().mockResolvedValue({content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Imported 中文 العربية'}]}]},warnings:['Custom tabs need review','Static checkboxes need review']});
 calls.list.mockReset().mockResolvedValue([{id:'local-other',title:'Local other',kind:'document',savedAt:'2026-10-02T12:00:00.000Z'}]);calls.open.mockReset().mockResolvedValue({...JSON.parse(raw),id:'local-other'});
 editor=new Editor({extensions:createExtensions(),content:'<p>Unsaved current text</p>'});await new Promise(resolve=>setTimeout(resolve,0));mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);onOpen=vi.fn();
 await act(async()=>root.render(createElement(LocalDocuments,{editor,title:'Current draft',blocked:false,documentId:'same-as-current',onOpen,capture:()=>{},exportDoc:()=>{},onLanguage:()=>{},onPrint:()=>{}})));
});
afterEach(()=>{act(()=>root.unmount());editor.destroy();mount.remove();vi.unstubAllGlobals();});
async function choose(text:()=>Promise<string>){
 const input=mount.querySelector('input[type="file"]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'Restore.vdoc.json',size:raw.length,arrayBuffer:async()=>new TextEncoder().encode(await text()).buffer}]});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
}
async function chooseWord(){
 const input=mount.querySelector('input[type="file"]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'Review.docx',size:10,arrayBuffer:async()=>new ArrayBuffer(10)}]});
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
}
it('reports Word conversion details only after the previous draft is saved and the new document is opened',async()=>{
 let finish!:(value:unknown)=>void;calls.activate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await chooseWord();
 expect(calls.save).toHaveBeenCalledOnce();expect(calls.info).not.toHaveBeenCalled();
 await act(async()=>finish(calls.activate.mock.calls[0][0]));
 expect(onOpen.mock.invocationCallOrder[0]).toBeLessThan(calls.info.mock.invocationCallOrder[0]);
 const html=renderToStaticMarkup(calls.info.mock.calls[0][1].description);expect(html).toContain('Custom tabs need review');expect(html).toContain('Static checkboxes need review');
 expect(onOpen.mock.calls[0][0]).not.toHaveProperty('warnings');
});
it.each(['save','activate'] as const)('does not report Word success or lose current text if %s fails',async stage=>{
 const before=editor.getJSON();calls[stage].mockRejectedValueOnce(new Error('Storage full'));await chooseWord();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);expect(onOpen).not.toHaveBeenCalled();expect(calls.info).not.toHaveBeenCalled();
 await chooseWord();expect(onOpen).toHaveBeenCalledOnce();expect(calls.info).toHaveBeenCalledOnce();
});
it('discards Word notices when activation finishes after the editor has been left',async()=>{
 let finish!:(value:unknown)=>void;calls.activate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await chooseWord();act(()=>root.unmount());
 await act(async()=>finish(calls.activate.mock.calls[0][0]));expect(onOpen).not.toHaveBeenCalled();expect(calls.info).not.toHaveBeenCalled();
});
async function menu(){await act(async()=>{mount.querySelector('[aria-label="File"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});}
function item(name:string){const result=Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent===name);if(!result)throw new Error(`Missing menu item ${name}`);return result;}
async function clickItem(name:string){await menu();await act(async()=>{item(name).click();});}
it.each(['new','open'])('protects active input when %s changes documents and permits retry',async action=>{
 let composing=true;const unregister=documentNavigation(editor).registerCompositionGuard(()=>composing);
 const before=editor.getJSON();
 const select=async()=>{
  if(action==='new') await clickItem('New document');
  else {
   if(!document.querySelector('.local-documents button')) await clickItem('Open local document');
   calls.save.mockClear();
   const choice=document.querySelector<HTMLButtonElement>('.local-documents button');
   if(choice) await act(async()=>choice.click());
  }
 };
 await select();expect(onOpen).not.toHaveBeenCalled();expect(calls.save).not.toHaveBeenCalled();
 expect(calls.activate).not.toHaveBeenCalled();expect(calls.open).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 composing=false;await select();expect(onOpen).toHaveBeenCalledOnce();
 expect(calls.save).toHaveBeenCalledWith('Current draft',before,'same-as-current');unregister();
});
it.each(['registered input','body'] as const)('does not open the document picker over an already active %s candidate',async kind=>{
 let composing=true;
 const unregister=documentNavigation(editor).registerCompositionGuard(()=>kind==='registered input'&&composing);
 if(kind==='body')Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>composing});
 const before=editor.getJSON();await clickItem('Open local document');
 expect(calls.save).not.toHaveBeenCalled();expect(calls.list).not.toHaveBeenCalled();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(editor.getJSON()).toEqual(before);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 expect(documentNavigation(editor).getSnapshot()).toBe('idle');
 composing=false;await clickItem('Open local document');
 expect(document.querySelector('.local-documents button')).not.toBeNull();unregister();
});
it.each([
 ['save','registered input'],['save','body'],['list','registered input'],['list','body'],
] as const)('keeps a %s completion from opening the picker over a new %s candidate and saves the latest draft on retry',async(stage,kind)=>{
 let finish!:(value:unknown)=>void,composing=false;
 calls[stage].mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const unregister=documentNavigation(editor).registerCompositionGuard(()=>kind==='registered input'&&composing);
 if(kind==='body')Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>composing});
 await clickItem('Open local document');
 act(()=>editor.commands.insertContent('Latest 中文 العربية '));const latest=editor.getJSON();composing=true;
 await act(async()=>finish(stage==='list'?[{id:'local-other',title:'Local other',kind:'document',savedAt:'2026-10-02T12:00:00.000Z'}]:{}));
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(editor.getJSON()).toEqual(latest);expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 expect(onOpen).not.toHaveBeenCalled();expect(calls.open).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();
 expect(documentNavigation(editor).getSnapshot()).toBe('idle');
 composing=false;await clickItem('Open local document');
 expect(calls.save).toHaveBeenLastCalledWith('Current draft',latest,'same-as-current');
 expect(document.querySelector('.local-documents button')).not.toBeNull();
 await act(async()=>document.querySelector<HTMLButtonElement>('.local-documents button')!.click());
 expect(onOpen).toHaveBeenCalledOnce();unregister();
});
it('validates a backup, preserves current edits and opens it with a fresh identity',async()=>{
 await choose(async()=>raw);expect(calls.save).toHaveBeenCalledWith('Current draft',editor.getJSON(),'same-as-current');
 expect(onOpen).toHaveBeenCalledOnce();const imported=onOpen.mock.calls[0][0];expect(imported.id).not.toBe('same-as-current');expect(imported.title).toBe('Imported backup');
 expect(imported.content.content[0].content[0].text).toBe('Restored 中文 العربية');expect(calls.activate).toHaveBeenCalledWith(imported);
 expect(calls.save.mock.invocationCallOrder[0]).toBeLessThan(calls.activate.mock.invocationCallOrder[0]);
});
it('rejects unsupported backup page margins while preserving the draft and allowing a corrected import',async()=>{
 const before=editor.getJSON(),bad=JSON.parse(raw);bad.content.attrs={...bad.content.attrs,pageMargin:200};
 await choose(async()=>JSON.stringify(bad));
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('page margins'));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('does not save, activate or replace the current document on invalid JSON',async()=>{
 await choose(async()=>'{broken');expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});
it('rejects an incomplete table grid without replacing the current draft and permits retry',async()=>{
 const before=editor.getJSON();const value=JSON.parse(raw);
 const cell={type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'Keep 中文'}]}]};
 value.content.content=[{type:'table',content:[{type:'tableRow',content:[cell,cell]},{type:'tableRow',content:[cell]}]}];
 await choose(async()=>JSON.stringify(value));
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('invalid table structure'));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('rejects corrupt backup bytes without replacing the draft and permits a valid retry',async()=>{
 const before=editor.getJSON(),input=mount.querySelector('input[type="file"]')!;
 const bytes=new TextEncoder().encode(raw.replace('Restored','@Restored'));bytes[bytes.indexOf(0x40)]=0xff;
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'Restore.vdoc.json',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('invalid UTF-8'));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('keeps the current document open if preserving its edits fails',async()=>{
 calls.save.mockRejectedValue(new Error('Storage full'));await choose(async()=>raw);
 expect(calls.error).toHaveBeenCalledWith('Storage full');expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});
it('does not reopen a late backup when the user leaves during file reading',async()=>{
 let finish!:(text:string)=>void;await choose(()=>new Promise(resolve=>{finish=resolve;}));act(()=>root.unmount());
 await act(async()=>{finish(raw);});expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});
it('preserves the latest title and edits made while a backup is being read',async()=>{
 let finish!:(text:string)=>void;await choose(()=>new Promise(resolve=>{finish=resolve;}));
 editor.commands.insertContent('Latest edit ');
 await act(async()=>root.render(createElement(LocalDocuments,{editor,title:'Renamed while importing',blocked:false,documentId:'same-as-current',onOpen,capture:()=>{},exportDoc:()=>{},onLanguage:()=>{},onPrint:()=>{}})));
 await act(async()=>{finish(raw);});expect(calls.save).toHaveBeenCalledWith('Renamed while importing',editor.getJSON(),'same-as-current');expect(onOpen).toHaveBeenCalledOnce();
});
it('does not activate the import if the user leaves while the previous document is being saved',async()=>{
 let finish!:()=>void;calls.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));await choose(async()=>raw);
 expect(calls.save).toHaveBeenCalledOnce();act(()=>root.unmount());await act(async()=>{finish();});
 expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});
it('ignores a second import while the first file is still being read',async()=>{
 let finish!:(text:string)=>void;await choose(()=>new Promise(resolve=>{finish=resolve;}));const second=vi.fn(async()=>raw.replace('Imported backup','Second backup'));
 await choose(second);expect(second).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();
 await act(async()=>{finish(raw);});expect(calls.activate).toHaveBeenCalledOnce();expect(onOpen.mock.calls[0][0].title).toBe('Imported backup');
});
it('keeps the import lock until activation finishes, even after reading and saving have completed',async()=>{
 let finish!:(value:unknown)=>void;calls.activate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await choose(async()=>raw);
 const second=vi.fn(async()=>raw);await choose(second);expect(second).not.toHaveBeenCalled();expect(calls.save).toHaveBeenCalledOnce();
 const imported=calls.activate.mock.calls[0][0];await act(async()=>{finish(imported);});expect(onOpen).toHaveBeenCalledOnce();
});
it('releases the import lock after read failure so the user can retry',async()=>{
 await choose(async()=>{throw new Error('File unavailable');});expect(calls.error).toHaveBeenCalledWith('File unavailable');
 await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('releases the import lock after activation failure and keeps current content available',async()=>{
 calls.activate.mockRejectedValueOnce(new Error('Could not open storage'));const before=editor.getJSON();await choose(async()=>raw);
 expect(calls.error).toHaveBeenCalledWith('Could not open storage');expect(onOpen).not.toHaveBeenCalled();expect(editor.getJSON()).toEqual(before);
 await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('disables competing file actions while importing but leaves backup downloads available',async()=>{
 let finish!:(text:string)=>void;await choose(()=>new Promise(resolve=>{finish=resolve;}));await menu();
 for(const name of ['New document','Open local document','Import document'])expect(item(name).getAttribute('aria-disabled')).toBe('true');
 expect(item('Download VDoc backup').getAttribute('aria-disabled')).not.toBe('true');expect(mount.querySelector('[role="status"]')?.textContent).toBe('Opening local file…');
 await act(async()=>{finish(raw);});expect(mount.querySelector('[role="status"]')?.textContent).toBe('');
});
it('starts only one new document when the menu action fires twice before React updates',async()=>{
 await menu();const action=item('New document');await act(async()=>{action.click();action.click();});
 expect(calls.save).toHaveBeenCalledOnce();expect(calls.activate).toHaveBeenCalledOnce();expect(onOpen).toHaveBeenCalledOnce();expect(onOpen.mock.calls[0][0].title).toBe('Untitled document');
});
it('keeps the local file list available after a failed read and allows retry',async()=>{
 await clickItem('Open local document');const local=Array.from(document.querySelectorAll<HTMLButtonElement>('.local-documents button')).find(node=>node.textContent?.startsWith('Local other'))!;
 calls.open.mockRejectedValueOnce(new Error('Read failed'));await act(async()=>{local.click();});
 expect(calls.error).toHaveBeenCalledWith('Read failed');expect(onOpen).not.toHaveBeenCalled();expect(local.disabled).toBe(false);
 await act(async()=>{local.click();});expect(onOpen).toHaveBeenCalledOnce();expect(onOpen.mock.calls[0][0].id).toBe('local-other');
});
it('distinguishes same-name same-time documents by folder and opens the chosen identity',async()=>{
 const savedAt='2026-10-08T00:00:00.000Z';
 calls.list.mockResolvedValue([
  {id:'folder-a',title:'中文',kind:'folder',parentId:null,savedAt},
  {id:'folder-b',title:'العربية',kind:'folder',parentId:'folder-a',savedAt},
  {id:'copy-a',title:'Same title',kind:'document',parentId:'folder-a',savedAt},
  {id:'copy-b',title:'Same title',kind:'document',parentId:'folder-b',savedAt},
  {id:'trashed-copy',title:'Same title',kind:'document',parentId:null,savedAt,trash:{at:savedAt}},
 ]);
 await clickItem('Open local document');
 const choices=Array.from(document.querySelectorAll<HTMLButtonElement>('.local-documents button'));
 expect(choices).toHaveLength(2);
 expect(choices[0].textContent).toContain('Workspace / 中文');
 expect(choices[1].textContent).toContain('Workspace / 中文 / العربية');
 const before=editor.getJSON();calls.open.mockResolvedValue({...JSON.parse(raw),id:'copy-b'});
 await act(async()=>choices[1].click());
 expect(calls.open).toHaveBeenCalledExactlyOnceWith('copy-b');
 expect(onOpen.mock.calls[0][0].id).toBe('copy-b');expect(editor.getJSON()).toEqual(before);
});
it('marks only the current document even when another document has the same title',async()=>{
 calls.list.mockResolvedValue(['same-as-current','another-copy'].map(id=>({id,title:'Same title',kind:'document',parentId:null,savedAt:'2026-10-08T00:00:00.000Z'})));
 await clickItem('Open local document');
 const choices=Array.from(document.querySelectorAll<HTMLButtonElement>('.local-documents button'));
 expect(choices[0].getAttribute('aria-current')).toBe('true');
 expect(choices[0].textContent).toContain('Current document');expect(choices[0].textContent).toContain('Workspace');
 expect(choices[1].hasAttribute('aria-current')).toBe(false);expect(choices[1].textContent).not.toContain('Current document');
});
it.each(['missing','cycle','trashed'])('does not mislabel a %s parent path as the workspace root',async kind=>{
 const savedAt='2026-10-08T00:00:00.000Z';
 calls.list.mockResolvedValue([
  {id:'orphan',title:'Preserved document',kind:'document',parentId:'parent',savedAt},
  ...(kind==='missing'?[]:[{id:'parent',title:'Folder',kind:'folder',parentId:kind==='cycle'?'parent':null,savedAt,...(kind==='trashed'?{trash:{at:savedAt}}:{})}]),
 ]);
 await clickItem('Open local document');
 const choice=document.querySelector<HTMLButtonElement>('.local-documents button')!;
 expect(choice.textContent).toContain('Unavailable folder');expect(choice.textContent).not.toContain('Workspace /');
 expect(choice.disabled).toBe(false);expect(calls.open).not.toHaveBeenCalled();
});
it('saves the current draft before selecting an existing document and restores editing on selection failure',async()=>{
 await clickItem('Open local document');calls.save.mockClear();const before=editor.getJSON();
 let fail!:(error:Error)=>void;calls.open.mockImplementation(()=>new Promise((_,reject)=>{fail=reject;}));
 await act(async()=>document.querySelector<HTMLButtonElement>('.local-documents button')!.click());
 expect(calls.save).toHaveBeenCalledOnce();expect(calls.open).toHaveBeenCalledWith('local-other');
 expect(calls.save.mock.invocationCallOrder[0]).toBeLessThan(calls.open.mock.invocationCallOrder[0]);
 expect(editor.isEditable).toBe(false);await act(async()=>fail(new Error('Selection failed')));
 expect(editor.isEditable).toBe(true);expect(editor.getJSON()).toEqual(before);expect(onOpen).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();
});
it('discards a late local-document selection after leaving the component',async()=>{
 await clickItem('Open local document');calls.save.mockClear();let finish!:(value:unknown)=>void;calls.open.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const local=document.querySelector<HTMLButtonElement>('.local-documents button')!;await act(async()=>{local.click();});act(()=>root.unmount());await act(async()=>{finish({...JSON.parse(raw),id:'local-other'});});
 expect(calls.save).toHaveBeenCalledOnce();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});

it('keeps the draft read-only from its final save through activation and restores editing after failure',async()=>{
 let saved!:()=>void,fail!:(error:Error)=>void;
 calls.save.mockImplementation(()=>new Promise<void>(resolve=>{saved=resolve;}));
 calls.activate.mockImplementation(()=>new Promise((_,reject)=>{fail=reject;}));
 const before=editor.getJSON();await choose(async()=>raw);
 expect(editor.isEditable).toBe(false);editor.commands.insertContent('Must not enter');expect(editor.getJSON()).toEqual(before);
 await act(async()=>{saved();});expect(editor.isEditable).toBe(false);editor.commands.insertContent('Still blocked');expect(editor.getJSON()).toEqual(before);
 await act(async()=>{fail(new Error('Activation failed'));});expect(editor.isEditable).toBe(true);expect(onOpen).not.toHaveBeenCalled();
 editor.commands.insertContent('Retry edit ');expect(editor.getText()).toContain('Retry edit');
 calls.save.mockResolvedValue({});calls.activate.mockImplementation(async value=>value);await choose(async()=>raw);expect(onOpen).toHaveBeenCalledOnce();
});
it('releases the editing lock when the final save fails',async()=>{
 calls.save.mockRejectedValue(new Error('Storage full'));await choose(async()=>raw);
 expect(editor.isEditable).toBe(true);expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
});
it('uses current content when reopening the current document from an older list snapshot',async()=>{
 await renderBlocked({current:false});
 calls.list.mockResolvedValue([{id:'same-as-current',title:'Stale title',kind:'document',savedAt:'2026-10-02T12:00:00.000Z'}]);
 calls.open.mockImplementation(async()=>{const [title,content,id]=calls.save.mock.calls.at(-1)!;return {...JSON.parse(raw),id,title,content};});
 await clickItem('Open local document');editor.commands.insertContent('Newest edit ');const latest=editor.getJSON();
 await act(async()=>{document.querySelector<HTMLButtonElement>('.local-documents button')!.click();});
 expect(onOpen.mock.calls[0][0].content).toEqual(latest);expect(onOpen.mock.calls[0][0].title).toBe('Current draft');
 expect(calls.open).toHaveBeenCalledWith('same-as-current');expect(calls.activate).not.toHaveBeenCalled();
 expect(calls.save.mock.invocationCallOrder.at(-1)).toBeLessThan(calls.open.mock.invocationCallOrder[0]);
});
it('does not save or activate while an input composition is unfinished',async()=>{
 Object.defineProperty(editor.view,'composing',{configurable:true,value:true});await choose(async()=>raw);
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
});
async function withHome(){
 const home=vi.fn();await act(async()=>root.render(createElement(Fragment,null,
  createElement(BackToDocuments,{editor,title:'Current draft',blocked:false,documentId:'same-as-current',onHome:home}),
  createElement(LocalDocuments,{editor,title:'Current draft',blocked:false,documentId:'same-as-current',onOpen,capture:()=>{},exportDoc:()=>{},onLanguage:()=>{},onPrint:()=>{}})
 )));return home;
}
it('disables return-home while a backup is being read without freezing the editor',async()=>{
 const home=await withHome();let finish!:(text:string)=>void;await choose(()=>new Promise(resolve=>{finish=resolve;}));
 const back=mount.querySelector<HTMLButtonElement>('[aria-label="Back to documents"]')!;expect(back.disabled).toBe(true);expect(editor.isEditable).toBe(true);
 await act(async()=>{back.click();});expect(home).not.toHaveBeenCalled();
 await act(async()=>{finish(raw);});expect(onOpen).toHaveBeenCalledOnce();expect(home).not.toHaveBeenCalled();
});
it('blocks a file action in the same event batch as returning home',async()=>{
 const home=await withHome();let finish!:()=>void;calls.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));await menu();const newDocument=item('New document');
 await act(async()=>{mount.querySelector<HTMLButtonElement>('[aria-label="Back to documents"]')!.click();newDocument.click();});
 expect(calls.save).toHaveBeenCalledOnce();expect(calls.activate).not.toHaveBeenCalled();
 await act(async()=>{finish();});expect(home).toHaveBeenCalledOnce();expect(onOpen).not.toHaveBeenCalled();
});
it('disables only the Word export item while preparing and keeps backups available',async()=>{
 await act(async()=>root.render(createElement(LocalDocuments,{editor,title:'Current draft',blocked:false,documentId:'same-as-current',onOpen,capture:()=>{},exportDoc:()=>{},onLanguage:()=>{},onPrint:()=>{},wordExportBusy:true})));
 await menu();expect(item('Preparing Word…').getAttribute('aria-disabled')).toBe('true');
 for(const name of ['Download VDoc backup','Download HTML','New document'])expect(item(name).getAttribute('aria-disabled')).not.toBe('true');
});

async function renderBlocked(blocked: boolean | { current: boolean }, exportDoc = vi.fn()) {
 await act(async()=>root.render(createElement(LocalDocuments,{editor,title:'Current draft',blocked,documentId:'same-as-current',onOpen,capture:()=>{},exportDoc,onLanguage:()=>{},onPrint:()=>{}})));
 return exportDoc;
}
it.each(['New document','Open local document','Import document'])('keeps a paused unsaved draft when requesting %s',async action=>{
 const before=editor.getJSON();await renderBlocked(true);
 if(action==='Import document') await choose(async()=>raw); else await clickItem(action);
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Autosave is paused'));
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
});
it('rejects an already-listed document if autosave pauses before it is selected',async()=>{
 await clickItem('Open local document');calls.save.mockClear();await renderBlocked(true);
 await act(async()=>document.querySelector<HTMLButtonElement>('.local-documents button')!.click());
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.isEditable).toBe(true);expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it('preserves a draft if autosave pauses while reading an import',async()=>{
 let finish!:(text:string)=>void;const before=editor.getJSON();await choose(()=>new Promise(resolve=>{finish=resolve;}));
 await renderBlocked(true);await act(async()=>finish(raw));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();expect(editor.getJSON()).toEqual(before);
});
it('does not activate a replacement when a conflict arrives during the final save',async()=>{
 let finish!:()=>void;calls.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));const before=editor.getJSON();
 await choose(async()=>raw);await renderBlocked(true);await act(async()=>finish());
 expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
});
it('keeps the current draft visible if the pause arrives after activation has already started',async()=>{
 let finish!:(value:unknown)=>void;calls.activate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const before=editor.getJSON();
 await choose(async()=>raw);const replacement=calls.activate.mock.calls[0][0];await renderBlocked(true);await act(async()=>finish(replacement));
 expect(onOpen).not.toHaveBeenCalled();expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('download a VDoc backup'));
});
it('leaves backup export available after rejecting navigation for a paused draft',async()=>{
 const exportDoc=await renderBlocked(true);await choose(async()=>raw);
 await clickItem('Download VDoc backup');expect(exportDoc).toHaveBeenCalledWith('json');expect(onOpen).not.toHaveBeenCalled();
});

it('observes a pause during the final save without waiting for a React render',async()=>{
 const blocked={current:false};await renderBlocked(blocked);
 let finish!:()=>void;calls.save.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 await choose(async()=>raw);blocked.current=true;await act(async()=>finish());
 expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Autosave is paused'));
});

it('rejects undecodable text before saving or replacing the current draft, then permits a corrected file',async()=>{
 const input=mount.querySelector('input[type="file"]')!;const before=editor.getJSON();
 const pick=async(bytes:Uint8Array<ArrayBuffer>)=>{
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'Notes.txt',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 };
 await pick(new Uint8Array([0xe4,0xb8]));
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Save it as UTF-8'));
 expect(calls.save).not.toHaveBeenCalled();expect(calls.activate).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 await pick(new TextEncoder().encode('Corrected 中文 العربية'));
 expect(onOpen).toHaveBeenCalledOnce();expect(onOpen.mock.calls[0][0].content.content[0].content[0].text).toBe('Corrected 中文 العربية');
});
