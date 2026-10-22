import { FormatOverride, VdocBold, VdocUnderline } from './format/format-overrides';
import { ParagraphBorderGroups } from './paragraph/paragraph-border-groups';
import { paragraphBordersAttribute } from './paragraph/paragraph-borders';
import { paragraphBackgroundAttribute } from './paragraph/paragraph-background';
import { ListConversion } from './list/list-conversion';
import { VdocTaskList } from './list/checklist';
import { ListEditing, selectedListItemType, availableIndentCommand } from './list/list-editing';
import { parseCellBorders, renderCellBorders, uniformBorderValue } from './table/table-borders';
import { VdocTable } from './table/table-layout';
import type { CommitTableResize } from './table/table-resize';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { LocalImage, PageBreak, Footnote, TableOfContents } from './features';
import { TaskItem, ListItem } from '@tiptap/extension-list';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TableKit, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin } from '@tiptap/pm/state';
import { Mapping, ReplaceStep, AddMarkStep, RemoveMarkStep, AttrStep, DocAttrStep } from '@tiptap/pm/transform';
import type { Operation } from '../domain/entities/operation';
import { paginationAttributes } from './paragraph/paragraph-pagination';
import { indentAttributes } from './paragraph/paragraph-indent';
import { tabIntervalAttribute, preserveTabWhitespace } from './paragraph/paragraph-tabs';
import { VdocBulletList } from './list/list-style';
import { VdocOrderedList } from './list/list-numbering';
import { SearchHighlights } from './search/search-highlights';
import { NativeSelectionSync } from './native-selection';
import { absoluteLengthPixels } from '../domain/text/font-size';

const nodeTypes = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'pageBreak', 'tableOfContents', 'taskList', 'taskItem'];

export const StableIds = Extension.create({
  name: 'stableIds',
  addGlobalAttributes() {
    return [{ types: nodeTypes, attributes: { blockId: {
      default: null,
      parseHTML: el => el.getAttribute('data-block-id'),
      renderHTML: attrs => attrs.blockId ? { 'data-block-id': attrs.blockId } : {},
    } } }];
  },
  onCreate() {
    this.editor.view.dispatch(this.editor.state.tr.setMeta('normalizeIds', true));
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
        // Text and mark edits cannot introduce or duplicate block IDs. Avoid a full
        // document traversal on every keystroke in a long document.
        if (!transactions.some(t => t.getMeta('normalizeIds')) && transactions.every(t => t.steps.every((step, i) => {
          if (step instanceof AddMarkStep || step instanceof RemoveMarkStep || step instanceof AttrStep || step instanceof DocAttrStep) return true;
          if (!(step instanceof ReplaceStep)) return false;
          const doc = t.docs[i];
          if (!doc.resolve(step.from).sameParent(doc.resolve(step.to))) return false;
          let inline = true; step.slice.content.forEach(node => { if (!node.isInline) inline = false; });
          return inline;
        }))) return null;
        const mapping = new Mapping();
        transactions.forEach(transaction => mapping.appendMapping(transaction.mapping));
        const originals = new Map<string, number>();
        oldState.doc.descendants((node, pos) => {
          if (!node.attrs.blockId || originals.has(node.attrs.blockId)) return;
          const mapped = mapping.map(pos, 1);
          if (mapped < state.doc.content.size && state.doc.nodeAt(mapped)?.attrs.blockId === node.attrs.blockId) originals.set(node.attrs.blockId, mapped);
        });
        const seen = new Set<string>();
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (!nodeTypes.includes(node.type.name)) return;
          const id = node.attrs.blockId;
          if (!id || seen.has(id) || (originals.has(id) && originals.get(id) !== pos)) {
            const newId = `b_${crypto.randomUUID()}`;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: newId });
            seen.add(newId);
          } else seen.add(id);
        });
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      },
    })];
  },
});

const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      ...paginationAttributes(),
      paragraphBorderJoin: {default:false,parseHTML:(el:HTMLElement)=>el.getAttribute('data-paragraph-border-join')==='true',renderHTML:(a:Record<string,unknown>)=>a.paragraphBorderJoin?{'data-paragraph-border-join':'true'}:{}},
      paragraphBorders: paragraphBordersAttribute(),
      paragraphBackground: paragraphBackgroundAttribute(),
      ...indentAttributes(),
      tabInterval: tabIntervalAttribute(),
      direction: { default: 'auto', parseHTML: el => ['ltr','rtl'].includes(el.getAttribute('dir') || el.style.direction) ? (el.getAttribute('dir') || el.style.direction) : 'auto', renderHTML: a => ({dir:a.direction || 'auto'}) },
      spaceBefore: { default: null, parseHTML: el => absoluteLengthPixels(el.style.marginTop), renderHTML: a => a.spaceBefore !== null ? { style: `margin-top: ${a.spaceBefore}px` } : {} },
      spaceAfter: { default: null, parseHTML: el => absoluteLengthPixels(el.style.marginBottom), renderHTML: a => a.spaceAfter !== null ? { style: `margin-bottom: ${a.spaceAfter}px` } : {} },
      lineHeight: { default: null, parseHTML: el => el.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
    } }];
  },
});

const background = {
  default: null,
  parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
  renderHTML: (attrs: Record<string, unknown>) => attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
};
const cellStyle = {
  backgroundColor: background,
  minHeight: { default: null, parseHTML: (el: HTMLElement) => el.style.height ? parseFloat(el.style.height) : null, renderHTML: (a: Record<string, unknown>) => a.minHeight != null ? { style: `height: ${a.minHeight}px` } : {} },
  borderColor: { default: null, parseHTML: (el: HTMLElement) => uniformBorderValue(el,'color') || null, renderHTML: (a: Record<string, unknown>) => a.borderColor ? { style: `border-color: ${a.borderColor}` } : {} },
  borderStyle: { default: 'solid', parseHTML: (el: HTMLElement) => ['dashed','dotted'].includes(uniformBorderValue(el,'style')) ? uniformBorderValue(el,'style') : 'solid', renderHTML: (a: Record<string, unknown>) => ({ style: `border-style: ${a.borderStyle || 'solid'}` }) },
  borderWidth: { default: null, parseHTML: (el: HTMLElement) => ['none','hidden'].includes(uniformBorderValue(el,'style')) ? 0 : uniformBorderValue(el,'width') ? parseFloat(uniformBorderValue(el,'width')) : null, renderHTML: (a: Record<string, unknown>) => a.borderWidth !== null ? { style: `border-width: ${a.borderWidth}px` } : {} },
  padding: { default: null, parseHTML: (el: HTMLElement) => el.style.padding ? parseFloat(el.style.padding) : null, renderHTML: (a: Record<string, unknown>) => a.padding !== null ? { style: `padding: ${a.padding}px` } : {} },
  borders: { default: null, parseHTML: parseCellBorders, renderHTML: renderCellBorders },
  verticalAlign: { default: 'top', parseHTML: (el: HTMLElement) => el.style.verticalAlign || 'top', renderHTML: (a: Record<string, unknown>) => ({ style: `vertical-align: ${a.verticalAlign}` }) },
};
const VdocRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), minHeight: cellStyle.minHeight,
  allowSplit: {
    default: false,
    parseHTML: (el: HTMLElement) => {
      const explicit = el.getAttribute('data-allow-split');
      if (explicit !== null) return explicit === 'true';
      return (el.style.breakInside || el.style.pageBreakInside) === 'auto';
    },
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-allow-split': String(attrs.allowSplit === true), style: `break-inside:${attrs.allowSplit === true ? 'auto' : 'avoid'};page-break-inside:${attrs.allowSplit === true ? 'auto' : 'avoid'}` }),
  },
}; } });
const VdocCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellStyle }; } });
const VdocHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellStyle }; } });

const ReferenceSync = Extension.create({
  name: 'referenceSync',
  addProseMirrorPlugins() { return [new Plugin({ appendTransaction(transactions, oldState, state) {
    if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
    const headings: { text: string; level: number }[] = [], notes: { pos: number; number: number; attrs: Record<string, unknown> }[] = [], contents: { pos: number; attrs: Record<string, unknown> }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') headings.push({ text: node.textContent || 'Untitled heading', level: node.attrs.level });
      if (node.type.name === 'footnote') notes.push({ pos, number: notes.length + 1, attrs: node.attrs });
      if (node.type.name === 'tableOfContents') contents.push({ pos, attrs: node.attrs });
    });
    const tr = state.tr;
    for (const note of notes) if (note.number !== note.attrs.number) tr.setNodeMarkup(note.pos, undefined, { ...note.attrs, number: note.number });
    for (const toc of contents) if (JSON.stringify(toc.attrs.items) !== JSON.stringify(headings)) tr.setNodeMarkup(toc.pos, undefined, { ...toc.attrs, items: headings });
    return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
  } })]; },
});

export function createExtensions(onShortcut?: (op: Operation | 'undo' | 'redo') => boolean, onResize?: CommitTableResize, onFormat?: (action:'copy'|'paste')=>boolean) {
  const Shortcuts = Extension.create({
    name: 'vdocShortcuts', priority: 1000,
    addKeyboardShortcuts() {
      const run = (op: Operation | 'undo' | 'redo') => () => onShortcut?.(op) ?? false;
      const format = (action:'copy'|'paste') => () => {
        if (!onFormat || this.editor.view.composing || !this.editor.isEditable) return false;
        onFormat(action);return true;
      };
      const indent = (direction: 'in' | 'out') => () => {
        if (this.editor.view.composing || !this.editor.isEditable) return false;
        const type = availableIndentCommand(this.editor, direction);
        // The editor owns these keys even at a boundary, avoiding browser history navigation.
        return type ? onShortcut?.({type, direction}) ?? false : true;
      };
      return {
        'Mod-Alt-c': format('copy'),
        'Mod-Alt-v': format('paste'),
        'Mod-]': indent('in'),
        'Mod-[': indent('out'),
        Tab: () => {
          if (this.editor.isActive('table') || this.editor.isActive('codeBlock')) return false;
          if (selectedListItemType(this.editor.state.selection)) return onShortcut?.({ type: 'list.indent', direction: 'in' }) ?? false;
          if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false;
          if (!this.editor.state.selection.$from.parent.isTextblock || this.editor.view.composing) return false;
          return onShortcut?.({ type: 'text.insert', text: '\t' }) ?? false;
        },
        'Shift-Tab': () => {
          if (this.editor.isActive('table') || this.editor.isActive('codeBlock') || !selectedListItemType(this.editor.state.selection)) return false;
          return onShortcut?.({ type: 'list.indent', direction: 'out' }) ?? false;
        },
        'Mod-b': run({ type: 'text.toggle', mark: 'bold' }),
        'Mod-i': run({ type: 'text.toggle', mark: 'italic' }),
        'Mod-u': run({ type: 'text.toggle', mark: 'underline' }),
        'Mod-Shift-x': run({ type: 'text.toggle', mark: 'strike' }),
        'Mod-z': run('undo'), 'Mod-Shift-z': run('redo'), 'Mod-y': run('redo'),
        'Mod-Alt-0': run({ type: 'paragraph.style', level: 0 }),
        'Mod-Alt-1': run({ type: 'paragraph.style', level: 1 }),
        'Mod-Alt-2': run({ type: 'paragraph.style', level: 2 }),
        'Mod-Alt-3': run({ type: 'paragraph.style', level: 3 }),
        'Mod-Shift-7': run({ type: 'list.toggle', kind: 'ordered' }),
        'Mod-Shift-8': run({ type: 'list.toggle', kind: 'bullet' }),
        'Mod-Shift-l': run({ type: 'paragraph.style', align: 'left' }),
        'Mod-Shift-e': run({ type: 'paragraph.style', align: 'center' }),
        'Mod-Shift-r': run({ type: 'paragraph.style', align: 'right' }),
        'Mod-Shift-j': run({ type: 'paragraph.style', align: 'justify' }),
      };
    },
  });
  return [
    NativeSelectionSync, SearchHighlights, FormatOverride, VdocBold, VdocUnderline,
    Document.extend({ addAttributes() { return { language: { default: 'und' }, pageSize: { default: 'a4' }, orientation: { default: 'portrait' }, pageMargin: { default: 20 }, pageColor: { default: '#FFFFFF' }, header: { default: '' }, footer: { default: '' }, pageNumbers: { default: false } }; } }),
    StarterKit.configure({ bold: false, underline: false, document: false, paragraph: false, heading: false, listItem: false, orderedList: false, bulletList: false, link: { openOnClick: false } }),
    Paragraph.extend({ parseHTML() { return [{ tag: 'p', getAttrs: preserveTabWhitespace, preserveWhitespace: 'full' }, ...(this.parent?.() || [])]; } }),
    Heading.extend({ parseHTML() { return [...this.options.levels.map(level => ({ tag: `h${level}`, getAttrs: (el: HTMLElement) => preserveTabWhitespace(el) === false ? false : { level }, preserveWhitespace: 'full' as const })), ...(this.parent?.() || [])]; } }).configure({ levels: [1, 2, 3, 4, 5, 6] }),
    VdocOrderedList, VdocBulletList, ListItem.extend({ content: '(paragraph | heading) block*' }), ListEditing, ListConversion,
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }), Superscript, Subscript,
    TableKit.configure({ table: false, tableRow: false, tableCell: false, tableHeader: false }), VdocTable.configure({ resizable: true, cellMinWidth: 40, onResize: onResize ?? null }), VdocRow,
    VdocTaskList, TaskItem.extend({ content() { return this.options.nested ? '(paragraph | heading) block*' : '(paragraph | heading)+'; } }).configure({ nested: true }), LocalImage, PageBreak, Footnote, TableOfContents, VdocCell, VdocHeader, ParagraphBorderGroups, ParagraphLayout, StableIds, ReferenceSync,
    Placeholder.configure({ placeholder: 'Start writing here…', showOnlyCurrent: true }),
    ...(onShortcut ? [Shortcuts] : []),
  ];
}
