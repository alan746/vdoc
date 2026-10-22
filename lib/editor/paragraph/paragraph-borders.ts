import type { Editor } from '@tiptap/core';
import { colorToHex } from '../../domain/text/color';
import { selectedParagraphs } from './paragraph-selection';

import { paragraphSides, paragraphBorderEdges, paragraphBorderDefaults, paragraphBordersSchema, paragraphBorderOperationSchema, emptyBorderValues, patchParagraphBorders, type ParagraphBorders, type ParagraphBorderOperation, type BorderValues } from '../../domain/rules/paragraph-borders';
export { paragraphSides, paragraphBorderEdges, paragraphBorderDefaults, paragraphBordersSchema, paragraphBorderOperationSchema, emptyBorderValues, patchParagraphBorders };
export type { ParagraphBorders, ParagraphBorderOperation, BorderValues };
export function selectedParagraphBorders(editor: Editor): BorderValues {
  const values = {...emptyBorderValues};
  const borders = selectedParagraphs(editor.state.doc,editor.state.selection).map(({node})=>(node.attrs.paragraphBorders || {}) as ParagraphBorders);
  for(const side of paragraphBorderEdges) {
    const first = Boolean(borders[0]?.[side]); values[side]=borders.every(b=>Boolean(b[side])===first)?first:null;
  }
  const joins=selectedParagraphs(editor.state.doc,editor.state.selection).map(({node})=>node.attrs.paragraphBorderJoin===true);
  values.join=joins.every(join=>join===joins[0])?joins[0]??false:null;
  const edges=borders.flatMap(b=>paragraphBorderEdges.flatMap(side=>b[side]?[b[side]!]:[]));
  for(const key of ['color','width','style','padding'] as const) {
    const first=edges[0]?.[key] ?? paragraphBorderDefaults[key];
    Object.assign(values,{[key]:edges.every(e=>e[key]===first)?first:null});
  }
  return values;
}
export function paragraphBorderChanges(before:BorderValues,after:BorderValues):ParagraphBorderOperation|null {
  const operation:ParagraphBorderOperation={type:'paragraph.border'};
  for(const key of [...paragraphBorderEdges,'join','color','width','style','padding'] as const) if(after[key] !== null && after[key] !== before[key]) Object.assign(operation,{[key]:after[key]});
  if (paragraphBorderEdges.some(side=>operation[side]===true)) for(const key of ['color','width','style','padding'] as const) if(after[key]!==null) Object.assign(operation,{[key]:after[key]});
  return Object.keys(operation).length>1?operation:null;
}
/** Only geometrically compatible siblings can share a continuous border. */
export function paragraphBorderGroupKey(attrs:Record<string,any>):string|null {
  const parsed=paragraphBordersSchema.safeParse(attrs.paragraphBorders);
  if(!attrs.paragraphBorderJoin||!parsed.success||!Object.keys(parsed.data).length)return null;
  const borders=paragraphBorderEdges.map(side=>{const b=parsed.data[side];return b?[b.width,b.style,b.color.toUpperCase(),b.padding]:null;});
  const start=(attrs.indentStart ?? (attrs.indent || 0)*24)+Math.max(0,-(attrs.firstLineIndent || 0));
  return JSON.stringify([borders,start,attrs.indentEnd||0,attrs.direction||'auto',colorToHex(attrs.paragraphBackground)]);
}
export function paragraphBordersAttribute() {
  return {default:null,parseHTML:(element:HTMLElement):ParagraphBorders|null=>{
    const metadata=element.getAttribute('data-paragraph-borders');
    if(metadata) {try {const parsed=paragraphBordersSchema.safeParse(JSON.parse(metadata));if(parsed.success)return parsed.data;}catch { /* External HTML falls back to its supported CSS. */ }}
    const result:ParagraphBorders={};
    for(const side of paragraphSides) {
      const style=element.style.getPropertyValue(`border-${side}-style`),width=parseFloat(element.style.getPropertyValue(`border-${side}-width`));
      if(!['solid','dashed','dotted'].includes(style)||!Number.isFinite(width)||width<=0||width>8)continue;
      const padding = Math.round((parseFloat(element.style.getPropertyValue(`padding-${side}`))||0)*.75);
      result[side]={style:style as 'solid'|'dashed'|'dotted',width,color:colorToHex(element.style.getPropertyValue(`border-${side}-color`))||paragraphBorderDefaults.color,padding:Math.min(31,Math.max(0,padding))};
    }
    return Object.keys(result).length?result:null;
  },renderHTML:(attrs:Record<string,unknown>)=>{
    const parsed=paragraphBordersSchema.nullable().safeParse(attrs.paragraphBorders);
    if(!parsed.success || !parsed.data)return {};
    const between=parsed.data.between;
    return {'data-paragraph-borders':JSON.stringify(parsed.data),...(paragraphBorderGroupKey(attrs)?{'data-paragraph-border-key':paragraphBorderGroupKey(attrs)!}:{}),style:(between ? [`--vdoc-between-border:${between.width}px ${between.style} ${between.color}`,`--vdoc-between-padding:${between.padding*4/3}px`] : []).concat([`--vdoc-border-top-padding:${(parsed.data.top?.padding||0)*4/3}px`],paragraphSides.flatMap(side=>{
      const edge=parsed.data![side];
      return edge?[`border-${side}:${edge.width}px ${edge.style} ${edge.color}`,`padding-${side}:${edge.padding*4/3}px`]:[];
    })).join(';')};
  }};
}
