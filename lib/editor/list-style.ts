import { CellSelection } from '@tiptap/pm/tables';
import { selectedCellLists } from './cell-lists';
import { bulletTextAttribute, validNumberAffix, validBulletText } from './list-markers';
import { BulletList } from '@tiptap/extension-list';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state';

export const orderedStyles = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as const;
export const bulletStyles = ['disc', 'circle', 'square'] as const;
export const listStyles = [...orderedStyles, ...bulletStyles] as const;
export type ListStyle = typeof listStyles[number];
export const htmlNumberTypes = ['1', 'a', 'A', 'i', 'I'] as const;
export const orderedStyle = (type: unknown) => orderedStyles[Math.max(0, htmlNumberTypes.indexOf(type as typeof htmlNumberTypes[number]))];
export const orderedType = (style: string) => htmlNumberTypes[Math.max(0, orderedStyles.indexOf(style as typeof orderedStyles[number]))];
export const bulletGlyphs = { disc: '•', circle: '○', square: '▪' } as const;

export function numberTypeAttribute() {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => {
      const type = el.getAttribute('type');
      if (htmlNumberTypes.includes(type as typeof htmlNumberTypes[number])) return type === '1' ? null : type;
      const css = el.style.listStyleType || (el.querySelector('li') as HTMLElement | null)?.style.listStyleType;
      const normalized = css === 'lower-latin' ? 'lower-alpha' : css === 'upper-latin' ? 'upper-alpha' : css;
      return normalized && orderedStyles.includes(normalized as typeof orderedStyles[number]) && normalized !== 'decimal' ? orderedType(normalized) : null;
    },
    renderHTML: (attrs: Record<string, unknown>) => ({ ...(attrs.type ? { type: attrs.type } : {}), style: `list-style-type:${orderedStyle(attrs.type)};--vdoc-counter-style:${orderedStyle(attrs.type)}` }),
  };
}

export const VdocBulletList = BulletList.extend({
  addAttributes() { return { ...this.parent?.(), bulletText: bulletTextAttribute(), bulletStyle: {
    default: 'disc',
    parseHTML: (el: HTMLElement) => {
      const value = el.style.listStyleType || el.getAttribute('type') || (el.querySelector('li') as HTMLElement | null)?.style.listStyleType;
      return bulletStyles.includes(value as typeof bulletStyles[number]) ? value : 'disc';
    },
    renderHTML: (attrs: Record<string, unknown>) => ({ style: `list-style-type:${bulletStyles.includes(attrs.bulletStyle as typeof bulletStyles[number]) ? attrs.bulletStyle : 'disc'}` }),
  } }; },
});

type Context = { node: Node; pos: number; parent: Node; parentStart: number };
function contextAt($pos: ResolvedPos): Context | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (['taskList','tableCell','tableHeader'].includes(node.type.name)) return null;
    if (['orderedList','bulletList'].includes(node.type.name)) return { node, pos: $pos.before(depth), parent: $pos.node(depth - 1), parentStart: $pos.start(depth - 1) };
  }
  return null;
}
export function listStyleContext(doc: Node, selection: Selection): Context | null {
  if (selection instanceof NodeSelection && ['orderedList','bulletList'].includes(selection.node.type.name)) return contextAt(doc.resolve(selection.from + 1));
  if (!(selection instanceof TextSelection)) return null;
  const from = contextAt(selection.$from), to = contextAt(doc.resolve(Math.max(selection.from, selection.to - 1)));
  return from && to && from.pos === to.pos ? from : null;
}
export const currentListStyle = (node: Node): ListStyle => node.type.name === 'orderedList' ? orderedStyle(node.attrs.type) : node.attrs.bulletStyle || 'disc';

/** Marker controls require one list family; paragraphs and checklists are left alone. */
export function listStyleTargets(doc: Node, selection: Selection): Context[] {
  if (selection instanceof CellSelection) {
    const targets = selectedCellLists(selection).filter(({node}) => node.type.name !== 'taskList');
    return targets.every(({node}) => node.type === targets[0].node.type) ? targets : [];
  }
  const context = listStyleContext(doc, selection);
  return context ? [context] : [];
}

/** A continued numbering series shares one marker style, including in Word. */
export function changeListStyle(tr: Transaction, style: ListStyle): boolean {
  const targets = listStyleTargets(tr.doc, tr.selection);
  if (!targets.length) return false;
  if (targets[0].node.type.name === 'bulletList') {
    if (!bulletStyles.includes(style as typeof bulletStyles[number])) return false;
    for (const {node,pos} of targets) if (node.attrs.bulletStyle !== style || node.attrs.bulletText !== null)
      tr.setNodeMarkup(pos, undefined, {...node.attrs, bulletStyle: style, bulletText: null});
    return true;
  }
  if (!orderedStyles.includes(style as typeof orderedStyles[number])) return false;
  const type = style === 'decimal' ? null : orderedType(style);
  for (const {node, pos} of connectedTargets(targets)) if (node.attrs.type !== type) tr.setNodeMarkup(pos, undefined, {...node.attrs, type});
  return true;
}

function connectedTargets(targets: Context[]) {
  return [...new Map(targets.flatMap(numberingGroup).map(target => [target.pos, target])).values()];
}

function numberingGroup(context: Context) {
  const groups: {node: Node; pos: number}[][] = [];
  context.parent.forEach((node, offset) => {
    if (node.type.name !== 'orderedList') return;
    if (!node.attrs.continuePrevious || !groups.length) groups.push([]);
    groups[groups.length - 1].push({node, pos: context.parentStart + offset});
  });
  const group = groups.find(nodes => nodes.some(node => node.pos === context.pos));
  return group || [];
}

export function changeListMarker(tr: Transaction, change: {prefix?:string; suffix?:string; bullet?:string|null}): boolean {
  const targets = listStyleTargets(tr.doc, tr.selection);
  if (!targets.length) return false;
  if (targets[0].node.type.name === 'bulletList') {
    if (change.prefix !== undefined || change.suffix !== undefined || change.bullet === undefined || (change.bullet !== null && !validBulletText(change.bullet))) return false;
    for (const {node,pos} of targets) if (node.attrs.bulletText !== change.bullet) tr.setNodeMarkup(pos, undefined, {...node.attrs, bulletText:change.bullet});
    return true;
  }
  if (change.bullet !== undefined || (change.prefix === undefined && change.suffix === undefined)) return false;
  if (change.prefix !== undefined && !validNumberAffix(change.prefix) || change.suffix !== undefined && !validNumberAffix(change.suffix)) return false;
  for (const {node,pos} of connectedTargets(targets)) {
    const attrs = {...node.attrs, ...(change.prefix !== undefined ? {numberPrefix:change.prefix} : {}), ...(change.suffix !== undefined ? {numberSuffix:change.suffix} : {})};
    if (attrs.numberPrefix !== node.attrs.numberPrefix || attrs.numberSuffix !== node.attrs.numberSuffix) tr.setNodeMarkup(pos, undefined, attrs);
  }
  return true;
}
