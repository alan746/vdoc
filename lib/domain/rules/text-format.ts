import { z } from 'zod';

const color=z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();
export const textFormatSchema=z.object({
  bold:z.boolean(),italic:z.boolean(),underline:z.boolean(),strike:z.boolean(),
  color,highlight:color,fontFamily:z.enum(['Arial','Georgia','Times New Roman','Noto Sans SC','monospace']).nullable(),
  fontSize:z.number().finite().min(8).max(96).nullable(),
  script:z.enum(['normal','superscript','subscript']),
}).strict();
export type TextFormat=z.infer<typeof textFormatSchema>;
