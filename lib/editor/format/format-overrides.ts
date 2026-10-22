import { Mark as TiptapMark, mergeAttributes, type CommandProps } from '@tiptap/core';
import { Mark, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import Bold from '@tiptap/extension-bold';
import Underline from '@tiptap/extension-underline';
export type InheritedFormat = 'bold' | 'underline';
const key = (name: InheritedFormat) => name === 'bold' ? 'boldOff' : 'underlineOff';
export function inheritedBold(pos: ResolvedPos) {
  for (let depth = pos.depth; depth > 0; depth--) if (['heading', 'tableHeader'].includes(pos.node(depth).type.name)) return true;
  return false;
}
export function effectiveFormat(marks: readonly Mark[], pos: ResolvedPos, name: InheritedFormat): boolean {
  if (marks.some(m => m.type.name === name)) return true;
  if (marks.some(m => m.type.name === 'formatOverride' && m.attrs[key(name)] === true)) return false;
  return name === 'bold' ? inheritedBold(pos) : marks.some(m => m.type.name === 'link');
}
export function effectiveFormatActive(state: Pick<EditorState, 'doc' | 'selection' | 'storedMarks'>, name: InheritedFormat): boolean {
  const { selection } = state;
  if (selection.empty) return effectiveFormat(state.storedMarks ?? selection.$from.marks(), selection.$from, name);
  let found = false, all = true;
  for (const { $from, $to } of selection.ranges) state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
    if (!node.isText) return;
    found = true;
    if (!effectiveFormat(node.marks, state.doc.resolve(pos), name)) all = false;
  });
  return found && all;
}
export function effectiveFormatMarks(marks: readonly Mark[], pos: ResolvedPos, name: InheritedFormat, enabled: boolean): readonly Mark[] {
    const schema = pos.doc.type.schema;
    let result = marks.filter(m => m.type.name !== name && m.type.name !== 'formatOverride');
    const attrs = { ...marks.find(m => m.type.name === 'formatOverride')?.attrs, [key(name)]: false };
    // Ordinary plain text needs no negative mark. Headings and links do, since
    // removing a positive mark alone does not disable their visual defaults.
    const inherited = name === 'bold' ? inheritedBold(pos) : marks.some(m => m.type.name === 'link');
    if (!enabled && (inherited || marks.some(m => m.type.name === 'formatOverride' && m.attrs[key(name)]))) attrs[key(name)] = true;
    if (attrs.boldOff || attrs.underlineOff) result = schema.marks.formatOverride.create(attrs).addToSet(result) as Mark[];
    if (enabled) result = schema.marks[name].create().addToSet(result) as Mark[];
    return result;
}
export function setEffectiveFormat(tr: Transaction, name: InheritedFormat, enabled: boolean): boolean {
  const schema = tr.doc.type.schema;
  if (tr.selection.empty) {
    const pos = tr.selection.$from;
    if (!['paragraph', 'heading'].includes(pos.parent.type.name)) return false;
    const marks = tr.storedMarks ?? pos.marks(); if (marks.some(m => m.type.name === 'code')) return false;
    tr.setStoredMarks(effectiveFormatMarks(marks, pos, name, enabled)); return true;
  }
  const ranges: { from: number; to: number; marks: readonly Mark[] }[] = [];
  for (const { $from, $to } of tr.selection.ranges) tr.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
    if (node.isText && parent && ['paragraph', 'heading'].includes(parent.type.name) && !node.marks.some(m => m.type.name === 'code')) ranges.push({from:Math.max(pos,$from.pos),to:Math.min(pos+node.nodeSize,$to.pos),marks:node.marks});
  });
  for (const range of ranges) {
    const marks = effectiveFormatMarks(range.marks, tr.doc.resolve(range.from), name, enabled);
    if (Mark.sameSet(marks, range.marks)) continue;
    tr.removeMark(range.from, range.to, schema.marks[name]);
    tr.removeMark(range.from, range.to, schema.marks.formatOverride);
    for (const mark of marks.filter(m => m.type.name === name || m.type.name === 'formatOverride')) tr.addMark(range.from, range.to, mark);
  }
  return ranges.length > 0;
}
export const FormatOverride = TiptapMark.create({
  name: 'formatOverride', priority: 1100,
  addAttributes() { return {
    boldOff: { default: false, parseHTML: e => e.getAttribute('data-bold-off') === 'true', rendered: false },
    underlineOff: { default: false, parseHTML: e => e.getAttribute('data-underline-off') === 'true', rendered: false },
  }; },
  parseHTML() { return [{ tag: 'span[data-vdoc-format-override]' }]; },
  renderHTML({ mark, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-vdoc-format-override': '', ...(mark.attrs.boldOff ? { 'data-bold-off': 'true', style: 'font-weight:400' } : {}), ...(mark.attrs.underlineOff ? { 'data-underline-off': 'true' } : {}) }), 0]; },
});
// Override must wrap the link: text-decoration on an ancestor cannot be cancelled
// by a descendant's text-decoration:none. This rule targets the anchor itself.
export const formatOverrideCSS = '[data-vdoc-format-override][data-underline-off="true"] a{text-decoration:none}';
function command(name: InheritedFormat, value?: boolean) {
  return ({ tr, dispatch }: CommandProps) => {
    const enabled = value ?? !effectiveFormatActive(tr, name);
    if (dispatch) return setEffectiveFormat(tr, name, enabled);
    if (tr.selection.empty) return ['paragraph', 'heading'].includes(tr.selection.$from.parent.type.name) && !(tr.storedMarks ?? tr.selection.$from.marks()).some(m => m.type.name === 'code');
    let applicable = false;
    for (const { $from, $to } of tr.selection.ranges) tr.doc.nodesBetween($from.pos, $to.pos, (node, _pos, parent) => {
      if (node.isText && parent && ['paragraph', 'heading'].includes(parent.type.name) && !node.marks.some(m => m.type.name === 'code')) applicable = true;
    });
    return applicable;
  };
}
export const VdocBold = Bold.extend({ addCommands() { return { setBold: () => command('bold', true), unsetBold: () => command('bold', false), toggleBold: () => command('bold') }; } });
export const VdocUnderline = Underline.extend({ addCommands() { return { setUnderline: () => command('underline', true), unsetUnderline: () => command('underline', false), toggleUnderline: () => command('underline') }; } });
