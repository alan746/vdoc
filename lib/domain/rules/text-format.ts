import { z } from 'zod/v3';
import { HEX_COLOR } from '../text/color';

const color=z.string().regex(HEX_COLOR).nullable();
export const textFormatSchema=z.object({
  bold:z.boolean(),italic:z.boolean(),underline:z.boolean(),strike:z.boolean(),
  color,highlight:color,fontFamily:z.enum(['Arial','Georgia','Times New Roman','Noto Sans SC','monospace']).nullable(),
  fontSize:z.number().finite().min(8).max(96).nullable(),
  script:z.enum(['normal','superscript','subscript']),
}).strict();
export type TextFormat=z.infer<typeof textFormatSchema>;
