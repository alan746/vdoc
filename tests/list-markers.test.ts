import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor,type JSONContent} from '@tiptap/core';
import JSZip from 'jszip';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import {parseDocument} from '../lib/infrastructure/persistence/storage';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
import {previewSource} from '../lib/infrastructure/preview/paged-preview';
import {markerCssString,validBulletText,validNumberAffix} from '../lib/editor/list/list-markers';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<ol start="4"><li><p>中文</p><ul><li><p>Nested</p></li></ul></li><li><p>עברית</p></li></ol><p>Gap</p><ol start="6" data-continue-numbering="true"><li><p>हिन्दी</p></li></ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
const select=(text:string)=>{let position=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)position=p;});if(position<0)throw Error(text);editor.commands.setTextSelection(position);};
const run=(op:unknown)=>engine.execute({operations:[op]});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
it('changes prefix and suffix across a continued group, without changing text, marks, IDs or nested bullets',()=>{
  select('हिन्दी');const before=editor.getJSON(),blocks=engine.snapshot().blocks;
  expect(run({type:'list.marker',prefix:'第',suffix:'条'}).ok).toBe(true);
  const numbered=editor.getJSON().content!.filter(n=>n.type==='orderedList');expect(numbered.map(n=>[n.attrs!.numberPrefix,n.attrs!.numberSuffix,n.attrs!.start])).toEqual([['第','条',4],['第','条',6]]);expect(engine.snapshot().blocks).toEqual(blocks);
  const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it('supports empty affixes, unchanged no-op, style changes and continuation adoption',()=>{
  select('中文');run({type:'list.marker',prefix:'(',suffix:')'});run({type:'list.style',style:'upper-roman'});
  expect(editor.state.doc.firstChild!.attrs).toMatchObject({numberPrefix:'(',numberSuffix:')',type:'I'});run({type:'list.marker',prefix:'',suffix:''});const revision=engine.revision;run({type:'list.marker',prefix:'',suffix:''});expect(engine.revision).toBe(revision);
  select('हिन्दी');run({type:'list.restart',start:10});run({type:'list.marker',prefix:'[',suffix:']'});run({type:'list.continue'});expect(editor.state.selection.$from.node(1).attrs).toMatchObject({numberPrefix:'',numberSuffix:'',start:6,type:'I'});
});
it.each(['★','✓','👩🏽‍💻','🇺🇳','é'])('round-trips one complete grapheme %s as a custom bullet',async bullet=>{
  select('Nested');const text=editor.getText();expect(run({type:'list.marker',bullet}).ok).toBe(true);expect(editor.getText()).toBe(text);
  const json=editor.getJSON(),html=editor.getHTML(),other=new Editor({extensions:createExtensions(),content:html});expect(other.getJSON()).toEqual(json);other.destroy();
  expect(parseDocument(JSON.stringify({version:1,title:'Markers',content:json})).content).toEqual(json);
  expect(new DOMParser().parseFromString(previewSource('Markers',html,json).html,'text/html').querySelector('ul')!.getAttribute('data-bullet-text')).toBe(bullet);
  const buffer=await bytes(await exportWord(json,'Markers')),zip=await JSZip.loadAsync(buffer);expect(await zip.file('word/numbering.xml')!.async('string')).toContain(`w:lvlText w:val="${bullet}"`);
  const result=await importWord(buffer);expect(result.warnings).toEqual([]);const nested=result.content.content![0].content![0].content!.find(n=>n.type==='bulletList')!;expect(nested.attrs!.bulletText).toBe(bullet);
});
it.each([['(',')'],['第','条'],['',''],['"','\\'],['%','%']])('round-trips numbering affixes %s / %s through native Word and HTML',async(prefix,suffix)=>{
  select('中文');run({type:'list.marker',prefix,suffix});run({type:'list.style',style:'lower-alpha'});const json=editor.getJSON();
  const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(json);other.destroy();
  const result=await importWord(await bytes(await exportWord(json,'Numbering')));expect(result.warnings).toEqual([]);
  expect(result.content.content!.filter(n=>n.type==='orderedList').map(n=>[n.attrs!.numberPrefix,n.attrs!.numberSuffix,n.attrs!.type,n.attrs!.start,n.attrs!.continuePrevious])).toEqual([[prefix,suffix,'a',4,false],[prefix,suffix,'a',6,true]]);
});
it('resets custom bullets when choosing a preset and supports explicitly clearing the custom character',()=>{
  select('Nested');run({type:'list.marker',bullet:'★'});run({type:'list.style',style:'circle'});expect(editor.getHTML()).not.toContain('data-bullet-text');
  run({type:'list.marker',bullet:'✓'});run({type:'list.marker',bullet:null});expect(editor.getHTML()).not.toContain('data-bullet-text');expect(editor.getHTML()).toContain('list-style-type: circle');
});
it('rejects invalid markers atomically and validates backups',()=>{
  select('中文');for(const prefix of ['123456789','\n','%1','\u202e','\ud800']){const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'No write'},{type:'list.marker',prefix}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);const bad=structuredClone(before);bad.content![0].attrs!.numberPrefix=prefix;expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content:bad}))).toThrow('affix');}
  select('Nested');for(const bullet of ['', 'AB', ' ', '\n', '\u200d']){expect(run({type:'list.marker',bullet}).ok).toBe(false);const bad:JSONContent=editor.getJSON();bad.content![0].content![0].content![1].attrs!.bulletText=bullet;expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content:bad}))).toThrow('custom bullet');}
});
it('refuses wrong list kinds, mixed fields and empty marker operations',()=>{
  select('中文');const before=editor.getJSON();expect(run({type:'list.marker',bullet:'★'}).ok).toBe(false);expect(run({type:'list.marker'}).ok).toBe(false);expect(run({type:'list.marker',prefix:'(',bullet:'★'}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  select('Nested');expect(run({type:'list.marker',suffix:')'}).ok).toBe(false);
});
it('escapes CSS payloads as text and drops invalid HTML attributes without interpreting markup',()=>{
  expect(markerCssString('";}')).toBe('"\\22 \\3b \\7d "');expect(validNumberAffix('";}')).toBe(true);expect(validBulletText('👩🏽‍💻')).toBe(true);
  editor.commands.setContent('<ol data-number-prefix="%1"><li><p>A</p></li></ol><ul data-bullet-text="AB"><li><p>B</p></li></ul>');expect(editor.state.doc.firstChild!.attrs.numberPrefix).toBe('');expect(editor.state.doc.child(1).attrs.bulletText).toBeNull();
});
