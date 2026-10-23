import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { findMatches } from '../lib/editor/search/search';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { languageSamples, unicodeSamples } from './multilingual-fixtures';
let editor:Editor, engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<p></p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
it.each([...languageSamples,...unicodeSamples.map((text,i)=>[`unicode-${i}`,text] as const)])('preserves %s text through insertion, formatting, literal replacement, undo and backup',(_,text)=>{
  expect(engine.execute({operations:[{type:'text.insert',text}]}).ok).toBe(true);
  expect(editor.getText()).toBe(text);
  editor.commands.selectAll();expect(engine.execute({operations:[{type:'text.style',style:{underline:true,highlight:'#FFF0AD'}}]}).ok).toBe(true);
  const before=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:text,content:before})).content).toEqual(before);
  const matches=findMatches(editor.state.doc,text);expect(matches).toHaveLength(1);
  expect(editor.state.doc.textBetween(matches[0].from,matches[0].to)).toBe(text);
  expect(engine.execute({operations:[{type:'text.findReplace',query:text,replacement:'REPLACED'}]}).ok).toBe(true);
  expect(editor.getText()).toBe('REPLACED');engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it.each(['👍🏽','👨‍👩‍👧‍👦','🇨🇦','e\u0301'])('does not find a fragment inside a grapheme %s',text=>{
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
  expect(findMatches(editor.state.doc,Array.from(text)[0])).toHaveLength(0);
});
it('finds canonically equivalent accents without damaging the original string offsets',()=>{
  editor.commands.setContent('<p>café café</p>');
  const matches=findMatches(editor.state.doc,'café');expect(matches).toHaveLength(2);
  expect(matches.map(m=>editor.state.doc.textBetween(m.from,m.to))).toEqual(['café','café']);
});
it('recognizes whole words in Thai and Japanese without requiring spaces',()=>{
  editor.commands.setContent('<p>ภาษาไทย</p><p>私は学生です</p>');
  expect(findMatches(editor.state.doc,'ภาษา',false,true)).toHaveLength(1);
  expect(findMatches(editor.state.doc,'学生',false,true)).toHaveLength(1);
});
it('rejects an explicit range that would split an emoji surrogate pair',()=>{
  editor.commands.setContent('<p>😀ok</p>');const before=editor.getJSON();
  const result=engine.execute({expectedRevision:engine.revision,target:{kind:'range',from:1,to:2},operations:[{type:'text.delete'}]});
  expect(result.ok).toBe(false);expect(editor.getJSON()).toEqual(before);
});

it('counts grapheme clusters, and segments words in scripts without spaces',async()=>{
  const {graphemeCount,textStatistics,documentStatistics}=await import('../lib/domain/text/unicode');
  expect(graphemeCount('👨‍👩‍👧‍👦👍🏽🇨🇦é')).toBe(4);
  expect(graphemeCount('한')).toBe(1);
  expect(textStatistics('🇨 🇦').characters).toBe(2);
  expect(textStatistics('ภาษาไทย').words).toBeGreaterThan(1);
  editor.commands.setContent('<p>👨‍👩‍👧‍👦 é</p><p>ภาษาไทย</p>');
  const before=documentStatistics(editor.state.doc);expect(before.characters).toBe(9);
  editor.commands.insertContentAt(1,'A');expect(documentStatistics(editor.state.doc).characters).toBe(before.characters+1);
});
it('applies explicit RTL direction through the operation layer and preserves it in backup and undo',()=>{
  editor.commands.setContent('<p>مرحبا VDoc 123</p>');const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'paragraph.style',direction:'rtl'}]}).ok).toBe(true);
  expect(editor.getHTML()).toContain('dir="rtl"');
  expect(parseDocument(JSON.stringify({version:1,title:'RTL',content:editor.getJSON()})).content.content![0].attrs!.direction).toBe('rtl');
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});

it.each(languageSamples)('persists %s language metadata without changing multilingual text and undoes it',async(locale,text)=>{
  const {exportHTML}=await import('../lib/infrastructure/export/html-export');
  editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});
  const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'document.language',language:locale}]}).ok).toBe(true);
  expect(editor.state.doc.attrs.language).toBe(locale);expect(editor.getText()).toBe(text);
  const backup=parseDocument(JSON.stringify({version:1,title:locale,content:editor.getJSON()}));
  expect(backup.content.attrs!.language).toBe(locale);
  expect(exportHTML(locale,editor.getHTML(),backup.content)).toContain(`lang="${locale}"`);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('canonicalizes regional language tags and rejects malformed tags atomically',()=>{
  expect(engine.execute({operations:[{type:'document.language',language:'zh-hant-tw'}]}).ok).toBe(true);
  expect(editor.state.doc.attrs.language).toBe('zh-Hant-TW');const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'text.insert',text:'must not appear'},{type:'document.language',language:'not_a_tag'}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
  expect(()=>parseDocument(JSON.stringify({version:1,title:'bad',content:{...before,attrs:{...before.attrs,language:'not_a_tag'}}}))).toThrow('language');
});
it('normalizes imported RGB and short hex palette values without dropping transparency',async()=>{
  const {colorToHex}=await import('../lib/domain/text/color');
  expect(colorToHex('rgb(255, 240, 173)')).toBe('#FFF0AD');
  expect(colorToHex('rgba(34,47,67,1)')).toBe('#222F43');
  expect(colorToHex('#abc')).toBe('#AABBCC');
  expect(colorToHex('rgba(34,47,67,0.5)')).toBeNull();
  expect(colorToHex('rgb(999,0,0)')).toBeNull();
});
