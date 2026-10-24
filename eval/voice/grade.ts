import type { JSONContent } from '@tiptap/core';

/** One expectation about the finished document or the agent's words. Blocks are found by text, never by ID. */
export type Check =
  | { marked: string; mark: string }
  | { notMarked: string; mark: string }
  | { exists: string }
  | { missing: string }
  | { inSection: string; text: string }
  | { last: string }
  | { tableInSection: string; rows: number; columns: number }
  | { heading: string; level: number }
  | { inList: string; list: 'bulletList' | 'orderedList' | 'taskList' }
  | { agentSaid: string }
  /** Every original top-level block whose text contains none of these strings is still there, unchanged and in order. New blocks are allowed. */
  | { othersUnchanged: string[] }
  /** The document is identical to the original (text, block types, heading levels and marks). */
  | { unchanged: true };

export type Grade = { pass: boolean; failures: string[] };

type Block = { type: string; level?: number; text: string; marks: string; list?: string; node: JSONContent };

const textOf = (node: JSONContent): string => node.text ?? (node.content ?? []).map(textOf).join('');

/** Mark types per text run, so "same text, now bold" counts as a change. */
function marksOf(node: JSONContent): string {
  if (node.type === 'text') return `${(node.marks ?? []).map(mark => mark.type).sort().join('+')}:${node.text}`;
  return (node.content ?? []).map(marksOf).join('|');
}

/** Top-level reading order, looking through lists so list items count as their paragraphs. */
function blocks(doc: JSONContent): Block[] {
  const out: Block[] = [];
  const visit = (node: JSONContent, list?: string) => {
    if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
      for (const item of node.content ?? []) for (const child of item.content ?? []) visit(child, node.type);
      return;
    }
    out.push({ type: node.type ?? '', level: node.attrs?.level as number | undefined, text: textOf(node), marks: marksOf(node), ...(list ? { list } : {}), node });
  };
  for (const node of doc.content ?? []) visit(node);
  return out;
}

const signature = (block: Block) => JSON.stringify([block.type, block.level ?? null, block.list ?? null, block.marks]);

function allTextHasMark(node: JSONContent, mark: string): boolean {
  const runs: JSONContent[] = [];
  const collect = (n: JSONContent) => { if (n.type === 'text') runs.push(n); else (n.content ?? []).forEach(collect); };
  collect(node);
  return runs.length > 0 && runs.every(run => (run.marks ?? []).some(m => m.type === mark));
}

/** The blocks after `heading` up to the next heading of the same or a higher level. */
function section(list: Block[], heading: string): Block[] | undefined {
  const start = list.findIndex(block => block.type === 'heading' && block.text.includes(heading));
  if (start < 0) return undefined;
  const level = list[start].level ?? 1;
  const end = list.findIndex((block, index) => index > start && block.type === 'heading' && (block.level ?? 1) <= level);
  return list.slice(start + 1, end < 0 ? undefined : end);
}

export function grade(original: JSONContent, final: JSONContent, agentSpeech: string, checks: readonly Check[]): Grade {
  const before = blocks(original), after = blocks(final);
  const failures: string[] = [];
  const find = (text: string) => after.find(block => block.text.includes(text));
  for (const check of checks) {
    if ('marked' in check) {
      const block = find(check.marked);
      if (!block || !allTextHasMark(block.node, check.mark)) failures.push(`"${check.marked}" is not entirely ${check.mark}`);
    } else if ('notMarked' in check) {
      const block = find(check.notMarked);
      if (!block) failures.push(`"${check.notMarked}" is missing`);
      else if (allTextHasMark(block.node, check.mark)) failures.push(`"${check.notMarked}" is still ${check.mark}`);
    } else if ('exists' in check) {
      if (!find(check.exists)) failures.push(`no block contains "${check.exists}"`);
    } else if ('missing' in check) {
      if (find(check.missing)) failures.push(`"${check.missing}" is still in the document`);
    } else if ('inSection' in check) {
      const blocksInSection = section(after, check.inSection);
      if (!blocksInSection) failures.push(`heading "${check.inSection}" is missing`);
      else if (!blocksInSection.some(block => block.text.includes(check.text))) failures.push(`"${check.text}" is not under "${check.inSection}"`);
    } else if ('last' in check) {
      const last = after.at(-1);
      if (!last || !last.text.includes(check.last)) failures.push(`the document does not end with "${check.last}"`);
    } else if ('tableInSection' in check) {
      const blocksInSection = section(after, check.tableInSection) ?? [];
      const table = blocksInSection.find(block => block.type === 'table');
      const rows = table?.node.content?.length ?? 0;
      const columns = table?.node.content?.[0]?.content?.length ?? 0;
      if (!table) failures.push(`no table under "${check.tableInSection}"`);
      else if (rows !== check.rows || columns !== check.columns) failures.push(`table is ${rows}x${columns}, expected ${check.rows}x${check.columns}`);
    } else if ('heading' in check) {
      const block = after.find(b => b.type === 'heading' && b.text.includes(check.heading));
      if (!block) failures.push(`heading "${check.heading}" is missing`);
      else if (block.level !== check.level) failures.push(`heading "${check.heading}" is level ${block.level}, expected ${check.level}`);
    } else if ('inList' in check) {
      const block = find(check.inList);
      if (!block) failures.push(`"${check.inList}" is missing`);
      else if (block.list !== check.list) failures.push(`"${check.inList}" is ${block.list ? `in a ${block.list}` : 'not in a list'}, expected ${check.list}`);
    } else if ('agentSaid' in check) {
      if (!new RegExp(check.agentSaid).test(agentSpeech)) failures.push(`the agent never said /${check.agentSaid}/`);
    } else if ('othersUnchanged' in check) {
      const kept = before.filter(block => !check.othersUnchanged.some(text => block.text.includes(text)));
      let cursor = 0;
      for (const block of kept) {
        const index = after.findIndex((candidate, i) => i >= cursor && signature(candidate) === signature(block));
        if (index < 0) { failures.push(`"${block.text}" changed, moved or disappeared`); continue; }
        cursor = index + 1;
      }
    } else if ('unchanged' in check) {
      if (JSON.stringify(before.map(signature)) !== JSON.stringify(after.map(signature))) failures.push('the document changed');
    }
  }
  return { pass: failures.length === 0, failures };
}

/** Character error rate of a transcript, ignoring spaces and punctuation. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const normalize = (text: string) => Array.from(text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''));
  const ref = normalize(reference), hyp = normalize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[hyp.length] / ref.length;
}
