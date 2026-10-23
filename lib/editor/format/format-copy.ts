import { effectiveFormat, effectiveFormatMarks } from './format-overrides';
import type {Editor} from '@tiptap/core';
import {Mark} from '@tiptap/pm/model';
import {AllSelection,TextSelection,type Selection,type Transaction} from '@tiptap/pm/state';
import {CellSelection} from '@tiptap/pm/tables';
import {colorToHex} from '../../domain/text/color';
import {absoluteFontPixels} from '../../domain/text/font-size';

import { textFormatSchema, type TextFormat } from '../../domain/rules/text-format';
const names=['formatOverride','bold','italic','underline','strike','textStyle','highlight','superscript','subscript'];

/** Cell selection ranges are not necessarily in document order. */
function formatSource(selection:Selection) {
  if(selection instanceof TextSelection&&selection.empty)
    return ['paragraph','heading'].includes(selection.$from.parent.type.name)?selection.$from:null;
  if(!(selection instanceof TextSelection||selection instanceof AllSelection||selection instanceof CellSelection))return null;
  for(const {$from,$to} of [...selection.ranges].sort((a,b)=>a.$from.pos-b.$from.pos)){
    let position:number|null=null;
    $from.doc.nodesBetween($from.pos,$to.pos,(node,pos,parent)=>{
      if(position!==null)return false;
      // A structural selection may intentionally start with an empty paragraph.
      if(!(selection instanceof TextSelection)&&['paragraph','heading'].includes(node.type.name)&&!node.content.size){position=pos+1;return false;}
      // Paragraph boundaries and inline atoms have no selected character style.
      if(node.isText&&parent&&['paragraph','heading'].includes(parent.type.name)){
        const start=Math.max(pos,$from.pos);
        if(start<Math.min(pos+node.nodeSize,$to.pos))position=start;
      }
    });
    if(position!==null)return $from.doc.resolve(position);
  }
  return null;
}

/** Sample the first selected character, or the caret's typing style. No document writes. */
export function copyTextFormat(editor:Editor):TextFormat|null {
  if(editor.isDestroyed||editor.view.composing)return null;
  const {selection,storedMarks}=editor.state;
  const source=formatSource(selection);if(!source)return null;
  const caret=selection instanceof TextSelection&&selection.empty;
  const marks=caret?(storedMarks??source.marks()):(source.nodeAfter?.marks??source.marks());
  if(marks.some(m=>m.type.name==='code'))return null;
  const attrs=(name:string)=>marks.find(m=>m.type.name===name)?.attrs;
  const dom=editor.view.domAtPos(source.pos,1);
  const node=dom.node.nodeType===3?dom.node:dom.node.childNodes[dom.offset]??dom.node;
  const element=node instanceof Element?node:node.parentElement;
  const base=caret||!source.parent.content.size?element?.closest('p,h1,h2,h3,h4,h5,h6'):element;
  const css=base?getComputedStyle(base):null;
  const scriptParent=base?.closest('sup,sub')?.parentElement;
  const fontCSS=scriptParent?getComputedStyle(scriptParent):css;
  const family=attrs('textStyle')?.fontFamily??css?.fontFamily??'';
  const known=['Arial','Georgia','Times New Roman','Noto Sans SC','monospace'].find(f=>family.split(',')[0].replace(/["']/g,'').trim().toLowerCase()===f.toLowerCase())??null;
  // Imported fonts outside the supported palette must not silently become defaults.
  if(attrs('textStyle')?.fontFamily&&!known)return null;
  const explicitSize=attrs('textStyle')?.fontSize;
  const computedSize=absoluteFontPixels(fontCSS?.fontSize);
  // Relative sizes can use browser-resolved pixels for selected text. A caret
  // can have pending marks that are not rendered yet, so its DOM is not evidence.
  const size=explicitSize?absoluteFontPixels(explicitSize)??(!caret?computedSize:null):computedSize;
  if(explicitSize&&size===null)return null;
  const format={bold:effectiveFormat(marks,source,'bold'),italic:!!attrs('italic'),
    underline:effectiveFormat(marks,source,'underline'),strike:!!attrs('strike'),color:colorToHex(attrs('textStyle')?.color??css?.color)??null,
    highlight:colorToHex(attrs('highlight')?.color)??null,fontFamily:known,fontSize:size,
    script:attrs('superscript')?'superscript':attrs('subscript')?'subscript':'normal'};
  const parsed=textFormatSchema.safeParse(format);
  return parsed.success?parsed.data:null;
}

export function canPasteTextFormat(editor:Editor):boolean {
  return !editor.isDestroyed&&editor.isEditable&&!editor.view.composing&&formatRanges(editor.state.tr).length>0;
}
function formatRanges(tr:Transaction){
  if(!(tr.selection instanceof TextSelection||tr.selection instanceof CellSelection||tr.selection instanceof AllSelection)||tr.selection.empty)return [];
  const ranges:{from:number;to:number;marks:readonly Mark[]}[]=[];
  for(const {$from,$to} of tr.selection.ranges)tr.doc.nodesBetween($from.pos,$to.pos,(node,pos,parent)=>{
    if(node.isText&&parent&&['paragraph','heading'].includes(parent.type.name)&&!node.marks.some(m=>m.type.name==='code'))
      ranges.push({from:Math.max(pos,$from.pos),to:Math.min(pos+node.nodeSize,$to.pos),marks:node.marks});
  });
  return ranges.filter(r=>r.to>r.from);
}

/** Replace supported character formatting, preserving links, content and structure. */
export function applyTextFormat(tr:Transaction,format:TextFormat):boolean {
  const ranges=formatRanges(tr);if(!ranges.length)return false;
  const schema=tr.doc.type.schema;
  const desired:Mark[]=[];
  for(const name of ['bold','italic','underline','strike'] as const)if(format[name])desired.push(schema.marks[name].create());
  const style={color:format.color,fontFamily:format.fontFamily,fontSize:format.fontSize===null?null:`${format.fontSize}px`};
  if(Object.values(style).some(v=>v!==null))desired.push(schema.marks.textStyle.create(style));
  if(format.highlight)desired.push(schema.marks.highlight.create({color:format.highlight}));
  if(format.script!=='normal')desired.push(schema.marks[format.script].create());
  for(const range of ranges){
    let result=range.marks.filter(m=>!names.includes(m.type.name));
    for(const mark of desired)result=mark.addToSet(result) as Mark[];
    const pos=tr.doc.resolve(range.from);
    result=effectiveFormatMarks(effectiveFormatMarks(result,pos,'bold',format.bold),pos,'underline',format.underline) as Mark[];
    if(Mark.sameSet(range.marks,result))continue;
    for(const name of names)tr.removeMark(range.from,range.to,schema.marks[name]);
    for(const mark of result.filter(mark=>names.includes(mark.type.name)))tr.addMark(range.from,range.to,mark);
  }
  return true;
}
