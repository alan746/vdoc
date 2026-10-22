import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { paragraphPropertyOperation } from '../lib/editor/paragraph-properties';
import { findMatches } from '../lib/editor/search';
let editor: Editor, engine: DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<p>Start</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
it.each(['𐐀apple apple𐐀 apple', 'x\u0301apple apple\u0301 apple'])('whole-word search respects Unicode letters and combining marks: %s',text=>{
  editor.commands.setContent(`<p>${text}</p>`);
  const matches=findMatches(editor.state.doc,'apple',false,true);
  expect(matches).toHaveLength(1);
  expect(matches[0].from).toBe(1+text.lastIndexOf('apple'));
  const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'text.findReplace',query:'apple',replacement:'Orange',wholeWord:true}]}).ok).toBe(true);
  expect(editor.getText()).toBe(text.slice(0,-5)+'Orange');engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('finds literal punctuation and preserves hard breaks and inline footnotes on replace',()=>{
  editor.commands.setContent('<p>A<br>B .* A</p>');
  expect(findMatches(editor.state.doc,'AB')).toHaveLength(0);
  expect(findMatches(editor.state.doc,'.*')).toHaveLength(1);
  editor.commands.setTextSelection(2);engine.execute({operations:[{type:'footnote.insert',text:'Keep this note'}]});
  const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.findReplace',query:'B',replacement:'Bee'}]}).ok).toBe(true);
  expect(editor.getHTML()).toContain('<br>');expect(editor.getJSON().content![0].content!.some(n=>n.type==='footnote')).toBe(true);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it.each(['bullet','ordered','task'] as const)('indents and outdents a %s list without losing text or undo history',kind=>{
  editor.commands.setContent('<p>One</p><p>Two</p><p>Three</p>');editor.commands.selectAll();
  expect(engine.execute({operations:[{type:'list.toggle',kind}]}).ok).toBe(true);
  const before=editor.getJSON();let position=0;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text==='Two')position=p;});editor.commands.setTextSelection(position);
  expect(engine.execute({operations:[{type:'list.indent',direction:'in'}]}).ok).toBe(true);
  const nested=editor.getJSON();expect(nested).not.toEqual(before);expect(editor.state.doc.textContent).toBe('OneTwoThree');
  expect(engine.execute({operations:[{type:'list.indent',direction:'out'}]}).ok).toBe(true);
  expect(editor.state.doc.textContent).toBe('OneTwoThree');
  engine.history('undo');expect(editor.getJSON()).toEqual(nested);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('clears only selected text marks, preserves paragraph structure, and undoes exactly',()=>{
  editor.commands.setContent('<h2 style="text-align:center"><strong>First Second</strong></h2>');const before=editor.getJSON();
  expect(engine.execute({expectedRevision:engine.revision,target:{kind:'range',from:1,to:6},operations:[{type:'text.clear'}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.type.name).toBe('heading');expect(editor.state.doc.firstChild!.attrs.textAlign).toBe('center');
  expect(editor.state.doc.firstChild!.firstChild!.marks).toHaveLength(0);expect(editor.state.doc.firstChild!.lastChild!.marks[0].type.name).toBe('bold');
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});

it('changes only requested paragraph spacing and preserves mixed indentation and margins',()=>{
  editor.commands.setContent('<p style="margin-top:4px;margin-bottom:12px;margin-left:24px">One</p><p style="margin-top:8px;margin-bottom:24px;margin-left:48px">Two</p>');
  editor.commands.selectAll();const before=editor.getJSON();
  const initial={spaceBefore:4,spaceAfter:12,indent:1};
  expect(paragraphPropertyOperation(initial,{...initial})).toBeNull();
  const operation=paragraphPropertyOperation(initial,{...initial,spaceBefore:16})!;
  expect(engine.execute({operations:[operation]}).ok).toBe(true);
  expect(editor.state.doc.child(0).attrs).toMatchObject({spaceBefore:16,spaceAfter:12,indent:1});
  expect(editor.state.doc.child(1).attrs).toMatchObject({spaceBefore:16,spaceAfter:24,indent:2});
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
