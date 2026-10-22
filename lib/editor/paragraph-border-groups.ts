import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform';
import type { Node } from '@tiptap/pm/model';
import { paragraphBorderGroupKey } from './paragraph-borders';

export const PARAGRAPH_BORDER_GROUP_CSS = `
[data-vdoc-border-next="true"] { margin-bottom:0!important; border-bottom:0!important; }
[data-vdoc-border-prev="true"] { margin-top:0!important; border-top:var(--vdoc-between-border,0 solid transparent)!important; padding-top:var(--vdoc-between-padding,var(--vdoc-border-top-padding,0px))!important; }
`;
const paragraph = (node:Node|undefined) => node && ['paragraph','heading'].includes(node.type.name);
function decorations(doc:Node) {
  const items:Decoration[]=[];
  doc.descendants((node,pos,parent,index)=>{
    if(!paragraph(node)||!parent)return;
    const key=paragraphBorderGroupKey(node.attrs);if(!key)return;
    const matches=(other:Node|undefined)=>paragraph(other)&&paragraphBorderGroupKey(other!.attrs)===key;
    const previous=index>0&&matches(parent.child(index-1)),next=index+1<parent.childCount&&matches(parent.child(index+1));
    if(previous||next)items.push(Decoration.node(pos,pos+node.nodeSize,{
      ...(previous?{'data-vdoc-border-prev':'true'}:{}),...(next?{'data-vdoc-border-next':'true'}:{}),
    }));
  });
  return DecorationSet.create(doc,items);
}
export const ParagraphBorderGroups = Extension.create({
  name:'paragraphBorderGroups',
  addProseMirrorPlugins(){return [new Plugin<DecorationSet>({
    state:{init:(_,state)=>decorations(state.doc),apply:(tr,current)=>{
      if(!tr.docChanged)return current;
      const inlineOnly=tr.steps.every((step,index)=>{
        if(step instanceof AddMarkStep||step instanceof RemoveMarkStep)return true;
        if(!(step instanceof ReplaceStep))return false;
        const from=tr.docs[index].resolve(step.from),to=tr.docs[index].resolve(step.to);
        if(!from.parent.inlineContent||!from.sameParent(to))return false;
        let inline=true;step.slice.content.forEach(node=>{if(!node.isInline)inline=false;});return inline;
      });
      return inlineOnly?current.map(tr.mapping,tr.doc):decorations(tr.doc);
    }},
    props:{decorations(state){return this.getState(state);}},
  })];},
});
/** Serialized HTML needs the same sibling grouping as the editable document. */
export function prepareParagraphBorderGroups(html:string) {
  const parsed=new DOMParser().parseFromString(html,'text/html');
  parsed.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6').forEach(node=>{
    node.removeAttribute('data-vdoc-border-prev');node.removeAttribute('data-vdoc-border-next');
    const key=node.getAttribute('data-paragraph-border-key');
    if(!key||node.getAttribute('data-paragraph-border-join')!=='true')return;
    const matches=(other:Element|null)=>other?.matches('p,h1,h2,h3,h4,h5,h6')&&other.getAttribute('data-paragraph-border-join')==='true'&&other.getAttribute('data-paragraph-border-key')===key;
    if(matches(node.previousElementSibling))node.setAttribute('data-vdoc-border-prev','true');
    if(matches(node.nextElementSibling))node.setAttribute('data-vdoc-border-next','true');
  });
  return parsed.body.innerHTML;
}
