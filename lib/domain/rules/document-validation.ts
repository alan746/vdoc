import type { JSONContent } from '@tiptap/core';
import type { SavedDocument } from '../entities/document';
import { canonicalLanguage } from '../text/language';
import { validNumberAffix, validBulletText } from './list-markers';
import { htmlNumberTypes, bulletStyles } from './list-styles';
import { validListStart } from './list-numbering';
import { paragraphBordersSchema } from './paragraph-borders';
import { validTabInterval } from './tab-interval';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Attrs = Record<string, any>;
/** One validation concern. Rules throw a user-facing Error on the first violation. */
export type NodeRule = (node: JSONContent, attrs: Attrs) => void;

const validColor = (value: unknown) => value == null || value === '' || typeof value === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d.,\s]+\)|transparent)$/i.test(value);

// Page setup attributes on the document root.
const pageRule: NodeRule = (node, attrs) => {
    if (node.type === 'doc') {
      // Match Page setup / document.layout. Unsupported backup settings must
      // not silently become A4 portrait or an unprintable page on export.
      if (attrs.pageSize !== undefined && !['a4', 'letter'].includes(attrs.pageSize)) throw new Error('The backup contains an unsupported page size. VDoc supports A4 and Letter.');
      if (attrs.orientation !== undefined && !['portrait', 'landscape'].includes(attrs.orientation)) throw new Error('The backup contains an invalid page orientation.');
      if (attrs.pageMargin !== undefined && (!Number.isInteger(attrs.pageMargin) || attrs.pageMargin < 5 || attrs.pageMargin > 50)) throw new Error('The backup contains unsupported page margins. Use a whole number from 5 to 50 mm.');
      if (attrs.pageNumbers !== undefined && typeof attrs.pageNumbers !== 'boolean') throw new Error('The backup contains an invalid page-number setting.');
    }
};

// Bullet, checklist and numbered list attributes.
const listRule: NodeRule = (node, attrs) => {
    if (node.type === 'bulletList' && attrs.bulletStyle !== undefined && !bulletStyles.includes(attrs.bulletStyle)) throw new Error('The backup contains an invalid bullet style.');
    if (node.type === 'bulletList' && attrs.bulletText != null && !validBulletText(attrs.bulletText)) throw new Error('The backup contains an invalid custom bullet.');
    if (node.type === 'taskList' && attrs.strikeCompleted !== undefined && typeof attrs.strikeCompleted !== 'boolean') throw new Error('The backup contains an invalid checklist style.');
    if (node.type === 'taskItem' && attrs.checked !== undefined && typeof attrs.checked !== 'boolean') throw new Error('The backup contains an invalid checklist state.');
    if (node.type === 'orderedList') {
      for (const key of ['numberPrefix','numberSuffix']) if (attrs[key] !== undefined && !validNumberAffix(attrs[key])) throw new Error('The backup contains an invalid numbering affix.');
      if (attrs.type != null && !htmlNumberTypes.includes(attrs.type)) throw new Error('The backup contains an invalid numbering style.');
      if (attrs.start !== undefined && !validListStart(attrs.start)) throw new Error('The backup contains an invalid list start.');
      if (attrs.continuePrevious !== undefined && typeof attrs.continuePrevious !== 'boolean') throw new Error('The backup contains an invalid numbering continuation.');
    }
};

// Paragraph decoration, tabs and indentation.
const paragraphRule: NodeRule = (node, attrs) => {
    if (attrs.paragraphBorderJoin !== undefined && typeof attrs.paragraphBorderJoin !== 'boolean') throw new Error('The backup contains an invalid paragraph border grouping.');
    if (attrs.paragraphBorders != null && !paragraphBordersSchema.safeParse(attrs.paragraphBorders).success) throw new Error('The backup contains invalid paragraph borders.');
    if (attrs.paragraphBackground != null && (typeof attrs.paragraphBackground !== 'string' || !/^#[0-9a-f]{6}$/i.test(attrs.paragraphBackground))) throw new Error('The backup contains an invalid paragraph background.');
    if (attrs.tabInterval !== undefined && !validTabInterval(attrs.tabInterval)) throw new Error('The backup contains an invalid tab interval.');
    for (const key of ['indentStart','indentEnd','firstLineIndent']) if (attrs[key] !== undefined && !(key==='indentStart' && attrs[key]===null) && (typeof attrs[key] !== 'number' || !Number.isFinite(attrs[key]) || Math.abs(attrs[key])>10000)) throw new Error('The backup contains invalid paragraph indentation.');
};

// Row and paragraph page-break controls.
const paginationRule: NodeRule = (node, attrs) => {
    if (node.type === 'tableRow' && attrs.allowSplit !== undefined && typeof attrs.allowSplit !== 'boolean') throw new Error('The backup contains an invalid row page-break setting.');
    if (['paragraph','heading'].includes(node.type || '')) for (const key of ['keepWithNext','keepLinesTogether','preventSingleLines']) {
      if (attrs[key] !== undefined && !(key === 'keepWithNext' && attrs[key] === null) && typeof attrs[key] !== 'boolean') throw new Error('The backup contains an invalid paragraph page-break setting.');
    }
};

// Table layout, document language, direction and text metadata.
const tableAndTextRule: NodeRule = (node, attrs) => {
    if (node.type === 'table' && attrs.pinnedRows != null && (!Number.isInteger(attrs.pinnedRows) || attrs.pinnedRows < 0 || attrs.pinnedRows > (node.content?.length || 0))) throw new Error('The backup contains an invalid pinned row count.');
    if (node.type === 'doc' && attrs.language != null && !canonicalLanguage(attrs.language)) throw new Error('The backup contains an invalid document language.');
    if (node.type === 'table' && attrs.columnDirection != null && !['ltr','rtl'].includes(attrs.columnDirection)) throw new Error('The backup contains an invalid column direction.');
    if (attrs.alignment != null && !['left','center','right'].includes(attrs.alignment)) throw new Error('The backup contains an invalid table alignment.');
    if (attrs.borderStyle != null && !['solid','dashed','dotted'].includes(attrs.borderStyle)) throw new Error('The backup contains an invalid border style.');
    if (attrs.direction != null && !['auto','ltr','rtl'].includes(attrs.direction)) throw new Error('The backup contains an invalid text direction.');
    for (const key of ['header','footer','alt']) if (attrs[key] != null && typeof attrs[key] !== 'string') throw new Error('The backup contains invalid text metadata.');
};

// Cell borders, colors, numeric layout values and spans.
const cellAndLayoutRule: NodeRule = (node, attrs) => {
    if (attrs.borders != null) {
      if (typeof attrs.borders !== 'object' || Array.isArray(attrs.borders)) throw new Error('The backup contains invalid cell borders.');
      for (const [side, border] of Object.entries(attrs.borders) as [string, any][]) {
        if (!['top','right','bottom','left'].includes(side) || !border || typeof border !== 'object' || Array.isArray(border) || Object.keys(border).some(key=>!['width','color','style'].includes(key)) || !validColor(border.color) || typeof border.color !== 'string' || !Number.isFinite(border.width) || border.width < 0 || border.width > 10000 || !['solid','dashed','dotted'].includes(border.style)) throw new Error('The backup contains invalid cell borders.');
      }
    }
    for (const key of ['backgroundColor', 'borderColor', 'pageColor']) if (!validColor(attrs[key])) throw new Error('The backup contains an invalid color.');
    for (const key of ['colspan', 'rowspan', 'width', 'height', 'minHeight', 'padding', 'borderWidth', 'indent', 'spaceBefore', 'spaceAfter', 'pageMargin']) {
      if (attrs[key] != null && (typeof attrs[key] !== 'number' || !Number.isFinite(attrs[key]) || attrs[key] < 0 || attrs[key] > 10000)) throw new Error('The backup contains an invalid layout value.');
    }
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      for (const key of ['colspan', 'rowspan']) if (attrs[key] != null && (!Number.isInteger(attrs[key]) || attrs[key] < 1)) throw new Error('The backup contains an invalid cell span.');
      if (attrs.colwidth != null && attrs.colwidth.length !== (attrs.colspan ?? 1)) throw new Error('The backup contains mismatched column widths.');
    }
    if (attrs.colwidth != null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10000))) throw new Error('The backup contains invalid column widths.');
};

// Contents, footnote and image blocks.
const embeddedBlockRule: NodeRule = (node, attrs) => {
    if (node.type === 'tableOfContents' && attrs.items != null && (!Array.isArray(attrs.items) || attrs.items.some((item: { text: unknown; level: unknown }) => !item || typeof item.text !== 'string' || typeof item.level !== 'number' || item.level < 1 || item.level > 6))) throw new Error('The contents block is invalid.');
    if (node.type === 'footnote' && typeof attrs.text !== 'string') throw new Error('The footnote is invalid.');
    if (node.type === 'image' && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(node.attrs?.src || '')) throw new Error('Images must be embedded in this local document.');
};

// Text marks: formatting overrides, links and colors.
const markRule: NodeRule = node => {
    for (const mark of node.marks || []) {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark) || typeof mark.type !== 'string') throw new Error('The backup contains invalid text formatting.');
      if (mark.type === 'formatOverride' && ((mark.attrs != null && (typeof mark.attrs !== 'object' || Array.isArray(mark.attrs))) || Object.keys(mark.attrs || {}).some(key => !['boldOff', 'underlineOff'].includes(key)) || ['boldOff', 'underlineOff'].some(key => mark.attrs?.[key] !== undefined && typeof mark.attrs[key] !== 'boolean'))) throw new Error('The backup contains invalid format overrides.');
      if (mark.type === 'link' && !/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href || '')) throw new Error('The backup contains an unsupported link.');
      if (!validColor(mark.attrs?.color)) throw new Error('The backup contains an invalid text color.');
    }
};

/** Ordered rule chain; order defines which error a damaged backup reports first. */
export const documentNodeRules: readonly NodeRule[] = [pageRule, listRule, paragraphRule, paginationRule, tableAndTextRule, cellAndLayoutRule, embeddedBlockRule, markRule];

/** Recursively validates a document tree against the rule chain. */
export function validateDocumentTree(root: JSONContent, rules: readonly NodeRule[] = documentNodeRules) {
  const inspect = (node: JSONContent, depth = 0) => {
    if (depth > 100) throw new Error('The document is nested too deeply.');
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string' || (node.content !== undefined && !Array.isArray(node.content)) || (node.marks !== undefined && !Array.isArray(node.marks))) throw new Error('The backup contains an invalid document structure.');
    const attrs = node.attrs || {};
    for (const rule of rules) rule(node, attrs);
    for (const child of node.content || []) inspect(child, depth + 1);
  };
  inspect(root);
}

/** Parses the backup envelope (BOM, JSON, version, title, root type) without touching node content. */
export function parseDocumentEnvelope(raw: string, maxLength = Infinity): Omit<SavedDocument, 'content'> & { content: JSONContent; id?: unknown; savedAt?: unknown } {
  if (raw.length > maxLength) throw new Error('The document exceeds the permitted length.');
  let value;
  try { value = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw); }
  catch { throw new Error('This backup is not valid JSON. Choose a complete VDoc backup file.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.title !== 'string' || value.title.length > 500 || value.content?.type !== 'doc') throw new Error('This is not a supported VDoc backup.');
  return value;
}
