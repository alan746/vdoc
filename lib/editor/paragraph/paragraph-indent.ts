import type { Attrs } from '@tiptap/pm/model';
import { selectedParagraphs } from './paragraph-selection';
import type { Editor } from '@tiptap/core';
import type { Operation } from '../../domain/entities/operation';

export const indentKeys = ['indentStart','indentEnd','firstLineIndent'] as const;
export type IndentValues = Record<typeof indentKeys[number], number | null>;
export function paragraphIndent(attrs: Attrs) {
  return {indentStart:attrs.indentStart ?? (attrs.indent || 0)*24,indentEnd:attrs.indentEnd || 0,firstLineIndent:attrs.firstLineIndent || 0};
}
export function stepParagraphIndent(current: number, direction: 'in' | 'out') {
  return direction === 'in' ? Math.min(10000, current + 24) : Math.min(current, Math.max(0, current - 24));
}
const px = (text: string) => {
  const match=text.trim().match(/^(-?\d*\.?\d+)(px|pt|pc|in|cm|mm)?$/i);
  return match ? Number(match[1])*({px:1,pt:96/72,pc:16,in:96,cm:96/2.54,mm:96/25.4}[match[2]?.toLowerCase() || 'px'] || 1) : null;
};
const dataNumber = (el: HTMLElement, key: string) => { const raw=el.getAttribute(key); return raw === null || raw === 'auto' ? null : px(raw); };
export function indentAttributes() {
  return {
    indent: {default:0,parseHTML:(el:HTMLElement)=>dataNumber(el,'data-indent-level') ?? Math.max(0,Math.round((px(el.style.marginLeft)||0)/24)),renderHTML:(a:Attrs)=>{
      const v=paragraphIndent(a),start=v.indentStart+Math.max(0,-v.firstLineIndent);
      return {'data-indent-level':String(a.indent || 0),'data-indent-start':a.indentStart == null?'auto':String(a.indentStart),'data-indent-end':String(v.indentEnd),'data-first-line-indent':String(v.firstLineIndent),style:`margin-inline-start:${start}px;margin-inline-end:${v.indentEnd}px;text-indent:${v.firstLineIndent}px`};
    }},
    indentStart:{default:null,rendered:false,parseHTML:(el:HTMLElement)=>{
      if(el.hasAttribute('data-indent-start'))return dataNumber(el,'data-indent-start');
      const rtl=(el.getAttribute('dir')||el.style.direction)==='rtl';
      const margin=px(el.style.marginInlineStart || (rtl?el.style.marginRight:el.style.marginLeft));
      return margin === null ? null : margin-Math.max(0,-(px(el.style.textIndent)||0));
    }},
    indentEnd:{default:0,rendered:false,parseHTML:(el:HTMLElement)=>dataNumber(el,'data-indent-end') ?? px(el.style.marginInlineEnd || ((el.getAttribute('dir')||el.style.direction)==='rtl'?el.style.marginLeft:el.style.marginRight)) ?? 0},
    firstLineIndent:{default:0,rendered:false,parseHTML:(el:HTMLElement)=>dataNumber(el,'data-first-line-indent') ?? px(el.style.textIndent) ?? 0},
  };
}
export function selectedIndent(editor:Editor):IndentValues {
  const result:IndentValues={indentStart:0,indentEnd:0,firstLineIndent:0};let found=false;
  for (const { node } of selectedParagraphs(editor.state.doc, editor.state.selection)) {
    const value=paragraphIndent(node.attrs);
    for(const key of indentKeys)result[key]=!found?value[key]:result[key]===value[key]?value[key]:null;
    found=true;
  } return result;
}
export function indentOperation(before:IndentValues,after:IndentValues):Extract<Operation,{type:'paragraph.style'}>|null {
  const result:Extract<Operation,{type:'paragraph.style'}>={type:'paragraph.style'};
  for(const key of indentKeys)if(after[key] !== null && before[key] !== after[key])result[key]=after[key];
  return Object.keys(result).length>1?result:null;
}
export function wordParagraphIndent(attrs:Attrs, listStart = 0) {
  const {indentStart,indentEnd,firstLineIndent}=paragraphIndent(attrs);
  if(attrs.indentStart == null && !attrs.indent && !indentEnd && !firstLineIndent)return undefined;
  const start=Math.round((listStart+indentStart+Math.max(0,-firstLineIndent))*15),end=Math.round(indentEnd*15);
  return {left:attrs.direction==='rtl'?end:start,right:attrs.direction==='rtl'?start:end,firstLine:firstLineIndent>=0?Math.round(firstLineIndent*15):undefined,hanging:firstLineIndent<0?Math.round(-firstLineIndent*15):undefined};
}
