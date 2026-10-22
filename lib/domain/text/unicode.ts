import type { Node } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';

const graphemes = new Intl.Segmenter('und', {granularity:'grapheme'});
const words = new Intl.Segmenter('und', {granularity:'word'});
const complex = /[^\x00-\x7F]|\r/u;

export function graphemeCount(text: string): number {
  if (!complex.test(text)) return text.length;
  let count = 0; for (const _ of graphemes.segment(text)) count++; return count;
}
/** Keep a complete-character prefix within a UTF-16 field length limit. */
export function truncateGraphemePrefix(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (!complex.test(text)) return text.slice(0, maxLength);
  let end = 0;
  for (const part of graphemes.segment(text)) {
    const next = part.index + part.segment.length;
    if (next > maxLength) break;
    end = next;
  }
  return text.slice(0, end);
}
/** Cell selections contain separate ranges; their primary from/to covers only one cell. */
export function selectionGraphemeCount(doc: Node, selection: Selection): number {
  return selection.ranges.reduce((total, range) => total + graphemeCount(doc.textBetween(range.$from.pos, range.$to.pos)), 0);
}
export function textStatistics(text: string) {
  let wordCount = 0;
  for (const part of words.segment(text)) if (part.isWordLike) wordCount++;
  let characters = 0;
  if (!complex.test(text)) characters = text.replace(/\s/gu,'').length;
  else for (const part of graphemes.segment(text)) if (!/^\s+$/u.test(part.segment)) characters++;
  return {characters,words:wordCount};
}
const statsCache = new WeakMap<Node, ReturnType<typeof textStatistics>>();
export function documentStatistics(node: Node): ReturnType<typeof textStatistics> {
  const cached = statsCache.get(node); if (cached) return cached;
  const stats = node.isTextblock ? textStatistics(node.textBetween(0,node.content.size,'',' ')) : {characters:0,words:0};
  if (!node.isTextblock) node.forEach(child=>{const value=documentStatistics(child);stats.characters+=value.characters;stats.words+=value.words;});
  statsCache.set(node,stats); return stats;
}
export function wordBoundaries(text: string) {
  const starts = new Set<number>(), ends = new Set<number>();
  for (const part of words.segment(text)) if (part.isWordLike) {starts.add(part.index);ends.add(part.index+part.segment.length);}
  return {starts,ends};
}
/** Map normalized grapheme boundaries back to original UTF-16 document offsets. */
export function normalizedSearchText(text: string) {
  if (!complex.test(text)) return {text, offsets:null};
  const offsets = new Map<number,number>([[0,0]]), parts:string[]=[];let size=0;
  for (const part of graphemes.segment(text)) {
    const value=part.segment.normalize('NFC');parts.push(value);size+=value.length;
    offsets.set(size,part.index+part.segment.length);
  }
  return {text:parts.join(''),offsets};
}
const boundaryCache = new WeakMap<Node, Map<number,number> | null>();
export function isTextBoundary(doc:Node, position:number):boolean {
  const resolved=doc.resolve(position), parent=resolved.parent;
  if (!parent.isTextblock) return true;
  let boundaries=boundaryCache.get(parent);
  if (boundaries===undefined) {
    const text=parent.textBetween(0,parent.content.size,'','\ufffc');
    boundaries=complex.test(text) ? new Map(Array.from(graphemes.segment(text),p=>[p.index,p.index])) : null;
    boundaries?.set(text.length,text.length);boundaryCache.set(parent,boundaries);
  }
  return boundaries===null || boundaries.has(resolved.parentOffset);
}
