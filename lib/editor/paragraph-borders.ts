import { z } from 'zod';
import type { Editor } from '@tiptap/core';
import { colorToHex } from './color';
import { selectedParagraphs } from './paragraph-selection';

export const paragraphSides = ['top','right','bottom','left'] as const;
export const paragraphBorderEdges = [...paragraphSides, 'between'] as const;
export const paragraphBorderDefaults = { color:'#334155', width:1, style:'solid' as const, padding:6 };
const edgeSchema = z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/),width:z.number().positive().max(8),style:z.enum(['solid','dashed','dotted']),padding:z.number().int().min(0).max(31)}).strict();
export const paragraphBordersSchema = z.object({top:edgeSchema.optional(),right:edgeSchema.optional(),bottom:edgeSchema.optional(),left:edgeSchema.optional(),between:edgeSchema.optional()}).strict();
export const paragraphBorderOperationSchema = z.object({type:z.literal('paragraph.border'),top:z.boolean().optional(),right:z.boolean().optional(),bottom:z.boolean().optional(),left:z.boolean().optional(),between:z.boolean().optional(),join:z.boolean().optional(),color:edgeSchema.shape.color.optional(),width:edgeSchema.shape.width.optional(),style:edgeSchema.shape.style.optional(),padding:edgeSchema.shape.padding.optional()}).strict();
export type ParagraphBorders = z.infer<typeof paragraphBordersSchema>;
export type ParagraphBorderOperation = z.infer<typeof paragraphBorderOperationSchema>;
export type BorderValues = {top:boolean|null;right:boolean|null;bottom:boolean|null;left:boolean|null;between:boolean|null;join:boolean|null;color:string|null;width:number|null;style:'solid'|'dashed'|'dotted'|null;padding:number|null};
export const emptyBorderValues: BorderValues = {top:false,right:false,bottom:false,left:false,between:false,join:false,...paragraphBorderDefaults};
export function patchParagraphBorders(current: ParagraphBorders | null, op: ParagraphBorderOperation): ParagraphBorders | null {
  const result: ParagraphBorders = {...current};
  for(const side of paragraphBorderEdges) {
    if(op[side] === false) { delete result[side]; continue; }
    if(!result[side] && op[side] !== true) continue;
    const edge = {...paragraphBorderDefaults,...result[side]};
    for(const key of ['color','width','style','padding'] as const) if(op[key] !== undefined) Object.assign(edge,{[key]:op[key]});
    result[side]=edge;
  }
  return Object.keys(result).length ? result : null;
}
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
