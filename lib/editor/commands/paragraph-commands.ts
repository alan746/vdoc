import { patchParagraphBorders } from '../paragraph/paragraph-borders';
import { selectedParagraphs } from '../paragraph/paragraph-selection';
import { paragraphIndent, stepParagraphIndent } from '../paragraph/paragraph-indent';
import { adjustRulerIndent } from '../paragraph/paragraph-ruler';
import type { HandlerMap } from './types';

/** Paragraph style, borders and indentation operations. */
export const paragraphCommands = {
  'paragraph.border': (op, { state }) => {
    const tr=state.tr, paragraphs=selectedParagraphs(tr.doc,tr.selection);
    if(!paragraphs.length) return false;
    for(const {node,pos} of paragraphs) {
      const paragraphBorders=patchParagraphBorders(node.attrs.paragraphBorders,op);
      const paragraphBorderJoin=op.join ?? node.attrs.paragraphBorderJoin;
      if(JSON.stringify(paragraphBorders)!==JSON.stringify(node.attrs.paragraphBorders)||paragraphBorderJoin!==node.attrs.paragraphBorderJoin) tr.setNodeMarkup(pos,undefined,{...node.attrs,paragraphBorders,paragraphBorderJoin});
    }
    return true;
  },
  'paragraph.style': (op, { state, c }) => {
    if (op.level !== undefined && !(op.level === 0 ? c.setParagraph() : c.setHeading({ level: op.level as 1 | 2 | 3 | 4 | 5 | 6 }))) return false;
    if (op.align && !c.setTextAlign(op.align)) return false;
    if (op.lineHeight) {
      void state.tr;
      const types = new Set(selectedParagraphs(state.doc, state.selection).map(({ node }) => node.type.name));
      for (const type of types) if (!c.updateAttributes(type, { lineHeight: op.lineHeight })) return false;
    }
    const layout: Record<string, number | string | boolean | null> = {};
    if (op.direction) layout.direction = op.direction;
    if (op.indent !== undefined) layout.indentStart = null;
    for (const key of ['paragraphBackground', 'tabInterval', 'indent', 'indentStart', 'indentEnd', 'firstLineIndent', 'spaceBefore', 'spaceAfter', 'keepWithNext', 'keepLinesTogether', 'preventSingleLines'] as const) if (op[key] !== undefined) layout[key] = op[key]!;
    if (Object.keys(layout).length) {
      void state.tr;
      const tr = state.tr;
      for (const { node, pos } of selectedParagraphs(tr.doc, tr.selection))
        if (Object.entries(layout).some(([key,value]) => node.attrs[key] !== value))
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...layout });
    }
    return true;
  },
  'paragraph.adjustIndent': (op, { state }) => {
    const tr = state.tr, paragraphs = selectedParagraphs(tr.doc, tr.selection);
    if (!paragraphs.length) return false;
    for (const { node, pos } of paragraphs) {
      const value = adjustRulerIndent(paragraphIndent(node.attrs), op.handle, op.delta);
      if (Object.values(value).some(n => !Number.isFinite(n) || Math.abs(n) > 10000)) return false;
      const patch = op.handle === 'end' ? { indentEnd: value.indentEnd }
        : op.handle === 'start' ? { indentStart: value.indentStart }
        : { indentStart: value.indentStart, firstLineIndent: value.firstLineIndent };
      if (op.delta) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
    }
    return true;
  },
  'paragraph.indent': (op, { state }) => {
    const tr=state.tr;
    for (const { node, pos } of selectedParagraphs(tr.doc, tr.selection)) {
      const current=node.attrs.indentStart ?? (node.attrs.indent || 0)*24;
      const next=stepParagraphIndent(current,op.direction);
      if(next!==current)tr.setNodeMarkup(pos,undefined,{...node.attrs,indentStart:next});
    } return true;
  },
} satisfies HandlerMap<'paragraph.border' | 'paragraph.style' | 'paragraph.adjustIndent' | 'paragraph.indent'>;
