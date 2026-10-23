import { paragraphBorderOperationSchema } from '../rules/paragraph-borders';
import { z } from 'zod/v3';
import { canonicalLanguage } from '../text/language';
import { validNumberAffix, validBulletText } from '../rules/list-markers';
import { listStyles } from '../rules/list-styles';
import { MAX_LIST_START } from '../rules/list-numbering';
import { textFormatSchema } from '../rules/text-format';
import { HEX_COLOR } from '../text/color';

const color = z.string().regex(HEX_COLOR, 'Use a six-digit hexadecimal color.');
export const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selection') }).strict(),
  z.object({ kind: z.literal('range'), from: z.number().int().min(0), to: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal('block'), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('cell'), tableId: z.string().min(1), cellId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('cells'), tableId: z.string().min(1), row: z.number().int().min(0), col: z.number().int().min(0), endRow: z.number().int().min(0).optional(), endCol: z.number().int().min(0).optional() }).strict(),
  z.object({ kind: z.literal('text'), blockId: z.string().min(1), start: z.number().int().min(0), end: z.number().int().min(0) }).strict(),
]);

export const operationSchema = z.discriminatedUnion('type', [
  paragraphBorderOperationSchema,
  z.object({type:z.literal('format.apply'),format:textFormatSchema}).strict(),
  z.object({ type: z.literal('text.style'), style: z.object({
    bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
    strike: z.boolean().optional(), color: color.nullable().optional(), highlight: color.nullable().optional(),
    fontFamily: z.enum(['Arial', 'Georgia', 'Times New Roman', 'Noto Sans SC', 'monospace']).optional(),
    fontSize: z.number().int().min(8).max(96).optional(),
    script: z.enum(['normal', 'superscript', 'subscript']).optional(),
  }).strict().refine(s => Object.keys(s).length > 0, 'Specify at least one text style.') }).strict().describe('Set only the supplied styles; omitted styles are preserved. To make text bold or italic use bold:true or italic:true; use false to remove that style. For color or font size, supply only the requested fields.'),
  z.object({ type: z.literal('text.toggle'), mark: z.enum(['bold', 'italic', 'underline', 'strike', 'superscript', 'subscript']) }).strict().describe('Invert one style. Use only when the user asks to toggle it; to enable or disable a style explicitly, use text.style.'),
  z.object({ type: z.literal('text.insert'), text: z.string().min(1).max(100000) }).strict(),
  z.object({ type: z.literal('text.clear') }).strict(),
  z.object({ type: z.literal('text.delete') }).strict(),
  z.object({ type: z.literal('text.replace'), text: z.string().max(100000) }).strict(),
  z.object({ type: z.literal('block.move'), id: z.string().min(1), beforeId: z.string().min(1).nullable() }).strict(),
  z.object({ type: z.literal('table.style'), borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(), borderColor: color.optional(), borderWidth: z.number().int().min(0).max(8).optional(), padding: z.number().int().min(0).max(40).optional(), minHeight: z.number().int().min(0).max(1000).optional(), verticalAlign: z.enum(['top', 'middle', 'bottom']).optional() }).strict(),
  z.object({ type: z.literal('table.border'), scope: z.enum(['all','outer','inner','top','right','bottom','left']), color, width: z.number().int().min(0).max(8), style: z.enum(['solid','dashed','dotted']) }).strict(),
  z.object({ type: z.literal('table.direction'), direction: z.enum(['ltr', 'rtl']) }).strict(),
  z.object({ type: z.literal('table.layout'), alignment: z.enum(['left', 'center', 'right']) }).strict(),
  z.object({ type: z.literal('table.pinRows'), count: z.number().int().min(0).max(10000) }).strict(),
  z.object({ type: z.literal('table.rowBreak'), from: z.number().int().min(0), to: z.number().int().min(1), allowSplit: z.boolean() }).strict(),
  z.object({ type: z.literal('table.rowHeight'), row: z.number().int().min(0), height: z.number().int().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('table.columnWidth'), column: z.number().int().min(0), width: z.number().int().min(40).max(1200) }).strict(),
  z.object({ type: z.literal('table.distributeRows'), from: z.number().int().min(0), to: z.number().int().min(1), height: z.number().int().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('table.split'), rows: z.number().int().min(1).max(10), cols: z.number().int().min(1).max(10) }).strict(),
  z.object({ type: z.literal('table.widths'), widths: z.array(z.number().int().min(40).max(1200)).min(1).max(30) }).strict(),
  z.object({ type: z.literal('paragraph.style'), paragraphBackground: color.nullable().optional(), tabInterval: z.number().int().min(8).max(480).optional(), indentStart: z.number().min(-10000).max(10000).optional(), indentEnd: z.number().min(-10000).max(10000).optional(), firstLineIndent: z.number().min(-10000).max(10000).optional(), keepWithNext: z.boolean().optional(), keepLinesTogether: z.boolean().optional(), preventSingleLines: z.boolean().optional(), direction: z.enum(['auto','ltr','rtl']).optional(), level: z.number().int().min(0).max(6).optional(), align: z.enum(['left', 'center', 'right', 'justify']).optional(), lineHeight: z.enum(['1', '1.15', '1.25', '1.5', '1.75', '2', '2.5', '3']).optional(), indent: z.number().int().min(0).max(8).optional(), spaceBefore: z.number().int().min(0).max(96).optional(), spaceAfter: z.number().int().min(0).max(96).optional() }).strict(),
  z.object({ type: z.literal('paragraph.indent'), direction: z.enum(['in','out']) }).strict(),
  z.object({ type: z.literal('paragraph.adjustIndent'), handle: z.enum(['start','firstLine','end']), delta: z.number().finite().min(-20000).max(20000) }).strict(),
  z.object({ type: z.literal('list.toggle'), kind: z.enum(['bullet', 'ordered', 'task']) }).strict(),
  z.object({ type: z.literal('list.checklistStyle'), strikeCompleted: z.boolean() }).strict(),
  z.object({ type: z.literal('list.marker'), prefix: z.string().refine(validNumberAffix, 'Use up to 8 characters without control characters or Word placeholders.').optional(), suffix: z.string().refine(validNumberAffix, 'Use up to 8 characters without control characters or Word placeholders.').optional(), bullet: z.string().refine(validBulletText, 'Use one visible character or emoji.').nullable().optional() }).strict(),
  z.object({ type: z.literal('list.style'), style: z.enum(listStyles) }).strict(),
  z.object({ type: z.literal('list.restart'), start: z.number().int().min(0).max(MAX_LIST_START) }).strict(),
  z.object({ type: z.literal('list.continue') }).strict(),
  z.object({ type: z.literal('list.indent'), direction: z.enum(['in', 'out']) }).strict(),
  z.object({ type: z.literal('text.findReplace'), query: z.string().min(1).max(1000), replacement: z.string().max(100000), caseSensitive: z.boolean().default(false), wholeWord: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('document.language'), language: z.string().max(100).refine(value => canonicalLanguage(value) !== null, 'Use a valid language tag.') }).strict(),
  z.object({ type: z.literal('document.layout'), pageSize: z.enum(['a4', 'letter']), orientation: z.enum(['portrait', 'landscape']), pageMargin: z.number().int().min(5).max(50), pageColor: color, header: z.string().max(500).optional(), footer: z.string().max(500).optional(), pageNumbers: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('image.insert'), src: z.string().max(3_000_000).regex(/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/), alt: z.string().max(500).default(''), width: z.number().int().min(40).max(1200).default(320) }).strict(),
  z.object({ type: z.literal('image.update'), alt: z.string().max(500).optional(), width: z.number().int().min(40).max(1200).optional() }).strict(),
  z.object({ type: z.literal('footnote.update'), text: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal('footnote.insert'), text: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal('block.code') }).strict(),
  z.object({ type: z.literal('block.toc') }).strict(),
  z.object({ type: z.literal('block.pageBreak') }).strict(),
  z.object({ type: z.literal('table.sort'), column: z.number().int().min(0), descending: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('table.move'), axis: z.enum(['row', 'column']), from: z.number().int().min(0), to: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('block.quote') }).strict(),
  z.object({ type: z.literal('block.rule') }).strict(),
  z.object({ type: z.literal('table.insert'), rows: z.number().int().min(1).max(30), cols: z.number().int().min(1).max(20), header: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal('table.edit'), action: z.enum(['rowBefore','rowAfter','columnBefore','columnAfter','deleteRow','deleteColumn','deleteTable','merge','split','headerRow']) }).strict(),
  z.object({ type: z.literal('table.background'), color: color.nullable() }).strict(),
  z.object({ type: z.literal('link.set'), href: z.string().max(2048).refine(v => /^(https?:\/\/|mailto:)/i.test(v), 'Links must start with https://, http://, or mailto:') }).strict(),
  z.object({ type: z.literal('link.unset') }).strict(),
  z.object({ type: z.literal('block.insert'), beforeId: z.string().min(1).nullable(), block: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('heading'), level: z.number().int().min(1).max(6), text: z.string().max(10000) }).strict(),
    z.object({ kind: z.literal('paragraph'), text: z.string().max(10000) }).strict(),
    z.object({
      kind: z.literal('table'), rows: z.number().int().min(1).max(30), cols: z.number().int().min(1).max(20), header: z.boolean().default(true),
      headerText: z.array(z.string().max(1000)).max(20).optional(),
      rowsText: z.array(z.array(z.string().max(1000)).max(20)).max(30).optional(),
    }).strict(),
  ]) }).strict(),
  z.object({ type: z.literal('block.delete'), id: z.string().min(1).describe('Required ID of the top-level block to delete, taken from a document read. Supply it even if target.id contains the same ID.') }).strict().describe('Delete the top-level block identified by this operation\'s id. The request target does not fill in this required id.'),
]);

export const requestSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  source: z.enum(['toolbar', 'keyboard', 'api', 'agent']).default('api'),
  label: z.string().max(100).optional(),
  /** Agent origin only: who asked for the edit and which turn it belongs to. */
  actor: z.string().min(1).max(128).optional(),
  turnId: z.string().min(1).max(128).optional(),
  expectedSessionId: z.string().min(1).max(128).optional(),
  expectedRevision: z.number().int().min(0).optional(),
  expectedBlocks: z.array(z.object({ id: z.string().min(1), version: z.number().int().min(1) }).strict()).min(1).max(1000).optional(),
  target: targetSchema.default({ kind: 'selection' }),
  operations: z.array(operationSchema).min(1).max(100),
}).strict().superRefine((request, ctx) => {
  if (request.source === 'agent') {
    if (!request.actor || !request.turnId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'Agent requests need an actor and a turn.' });
    if (request.target.kind === 'selection') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'Agent requests need an explicit target.' });
  } else if (request.actor !== undefined || request.turnId !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'Only agent requests carry an actor or turn.' });
  request.operations.forEach((op, i) => {
    if (op.type === 'paragraph.border' && Object.keys(op).length === 1) ctx.addIssue({code:z.ZodIssueCode.custom,path:['operations',i],message:'Specify at least one paragraph border setting.'});
    if (op.type === 'paragraph.style' && op.paragraphBackground === undefined && op.tabInterval === undefined && !op.direction && op.level === undefined && !op.align && !op.lineHeight && op.indent === undefined && op.indentStart === undefined && op.indentEnd === undefined && op.firstLineIndent === undefined && op.spaceBefore === undefined && op.spaceAfter === undefined && op.keepWithNext === undefined && op.keepLinesTogether === undefined && op.preventSingleLines === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', i], message: 'Specify at least one paragraph style.' });
    }
    if (op.type === 'block.insert' && op.block.kind === 'table') {
      const { cols, rows, header, headerText, rowsText } = op.block;
      if (headerText && (!header || headerText.length !== cols)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', i, 'block', 'headerText'], message: 'headerText requires header: true and one entry per column.' });
      if (rowsText?.some(row => row.length !== cols)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', i, 'block', 'rowsText'], message: 'Each row in rowsText must have one entry per column.' });
      if (rowsText && rowsText.length > rows - (header ? 1 : 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['operations', i, 'block', 'rowsText'], message: 'rowsText has more rows than the table.' });
    }
  });
});

/** External callers bind edits to a session and a revision or covering block versions. */
export const externalRequestSchema = requestSchema.innerType().omit({ actor: true, turnId: true }).extend({
  source: z.literal('api').default('api'),
  expectedSessionId: z.string().min(1).max(128),
  target: z.union([targetSchema.options[1], targetSchema.options[2], targetSchema.options[3], targetSchema.options[4], targetSchema.options[5]]),
});

/** Agent callers follow the external rules; the engine supplies source, actor and turn. */
export const agentRequestSchema = externalRequestSchema.omit({ source: true });
export type AgentOrigin = { actor: string; turnId: string };

export type Operation = z.infer<typeof operationSchema>;
export type Target = z.infer<typeof targetSchema>;
export type OperationRequest = z.input<typeof requestSchema>;
export type OperationResult = { ok: boolean; revision: number; id: string; error?: string; code?: 'INVALID' | 'STALE' | 'TARGET' | 'UNAVAILABLE' | 'COMPOSING' | 'DUPLICATE'; };
export type OperationRecord = { id: string; label: string; source: string; time: number; revision: number; count: number; actor?: string; turnId?: string };
/** One successful engine request, after all appended normalization transactions. */
export interface AppliedChange {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly actor?: string;
  readonly turnId?: string;
  readonly revision: number;
  readonly changedBlockIds: readonly string[];
  /** True for document changes (including root attributes); false for stored marks only. */
  readonly documentChanged: boolean;
}

export function operationLabel(op: Operation): string {
  const labels: Record<Operation['type'], string> = {
    'paragraph.border': 'Paragraph borders', 'format.apply': 'Paste text formatting',
    'paragraph.adjustIndent': 'Adjust paragraph indentation',
    'table.direction': 'Change column order',
    'table.pinRows': 'Pin header rows',
    'table.rowBreak': 'Set row page breaks',
    'table.rowHeight': 'Resize row', 'table.columnWidth': 'Resize column',
    'footnote.update': 'Edit footnote', 'footnote.insert': 'Insert footnote', 'block.code': 'Code block', 'block.toc': 'Insert table of contents', 'document.language': 'Document language', 'document.layout': 'Page setup', 'text.findReplace': 'Replace all', 'list.indent': 'Change indent', 'paragraph.indent': 'Change paragraph indent', 'image.insert': 'Insert image', 'image.update': 'Image properties', 'block.pageBreak': 'Insert page break', 'table.sort': 'Sort table', 'table.move': 'Move table row or column', 'text.style': 'Set text style', 'text.toggle': 'Toggle text style', 'text.insert': 'Insert text', 'text.clear': 'Clear formatting', 'text.delete': 'Delete text', 'text.replace': 'Replace text', 'block.move': 'Move block', 'table.border': 'Set table borders', 'table.layout': 'Align table', 'table.distributeRows': 'Distribute rows', 'table.split': 'Split cell', 'table.style': 'Format cells', 'table.widths': 'Set column widths',
    'paragraph.style': 'Set paragraph style', 'list.toggle': 'Toggle list', 'list.checklistStyle': 'Checklist options', 'list.marker': 'Custom list marker', 'list.style': 'List style', 'list.restart': 'Restart numbering', 'list.continue': 'Continue previous numbering', 'block.quote': 'Toggle blockquote', 'block.rule': 'Insert divider',
    'table.insert': 'Insert table', 'table.edit': 'Edit table', 'table.background': 'Set cell background', 'link.set': 'Add link', 'link.unset': 'Remove link',
    'block.insert': 'Insert block', 'block.delete': 'Delete block',
  };
  if (op.type === 'text.toggle') return { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', superscript: 'Superscript', subscript: 'Subscript' }[op.mark];
  return labels[op.type];
}
