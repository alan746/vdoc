import { z } from 'zod';

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
