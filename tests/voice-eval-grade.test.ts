import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import cases from '../eval/voice/cases.json';
import { fixtureDocument } from '../eval/voice/fixture';
import { characterErrorRate, grade, type Check } from '../eval/voice/grade';

const original = fixtureDocument();
const edit = (change: (content: JSONContent[]) => void): JSONContent => {
  const doc = structuredClone(original);
  change(doc.content!);
  return doc;
};
const bold = (node: JSONContent) => { node.content![0].marks = [{ type: 'bold' }]; };

describe('voice eval grading', () => {
  it('passes an untouched document and fails any change to it', () => {
    expect(grade(original, original, '', [{ unchanged: true }])).toEqual({ pass: true, failures: [] });
    expect(grade(original, edit(content => bold(content[1])), '', [{ unchanged: true }]).pass).toBe(false);
  });

  it('checks a mark on the intended block while every other block stays exactly the same', () => {
    const right = edit(content => bold(content[1]));
    expect(grade(original, right, '', [{ marked: '本项目旨在', mark: 'bold' }, { othersUnchanged: ['本项目旨在'] }]).pass).toBe(true);
    const alsoWrong = edit(content => { bold(content[1]); bold(content[8]); });
    expect(grade(original, alsoWrong, '', [{ othersUnchanged: ['本项目旨在'] }]).failures).toEqual(['"预算总额为十万元。" changed, moved or disappeared']);
    expect(grade(original, original, '', [{ marked: '本项目旨在', mark: 'bold' }]).pass).toBe(false);
  });

  it('places new content by section, at the end, in tables and in lists', () => {
    const inserted = edit(content => {
      content.splice(7, 0, { type: 'paragraph', content: [{ type: 'text', text: '第二阶段将在下个月开始。' }] });
      content.push({ type: 'table', content: Array.from({ length: 3 }, () => ({ type: 'tableRow', content: [{ type: 'tableCell' }, { type: 'tableCell' }] })) });
      content.push({ type: 'paragraph', content: [{ type: 'text', text: '谢谢大家。' }] });
    });
    expect(grade(original, inserted, '', [
      { inSection: '进度', text: '第二阶段' }, { tableInSection: '预算', rows: 3, columns: 2 }, { last: '谢谢大家' }, { othersUnchanged: [] },
    ])).toEqual({ pass: true, failures: [] });
    expect(grade(original, inserted, '', [{ inSection: '背景', text: '第二阶段' }, { tableInSection: '预算', rows: 2, columns: 2 }]).failures)
      .toEqual(['"第二阶段" is not under "背景"', 'table is 3x2, expected 2x2']);
    const listed = edit(content => {
      content.splice(3, 2, { type: 'bulletList', content: [content[3], content[4]].map(paragraph => ({ type: 'listItem', content: [paragraph] })) });
    });
    expect(grade(original, listed, '', [{ inList: '用户希望', list: 'bulletList' }, { inList: '现有工具', list: 'bulletList' }]).pass).toBe(true);
    expect(grade(original, original, '', [{ inList: '用户希望', list: 'bulletList' }]).failures).toEqual(['"用户希望" is not in a list, expected bulletList']);
  });

  it('checks headings, removals and what the agent said', () => {
    const changed = edit(content => { content[2].attrs = { level: 1 }; content.splice(6, 1); });
    expect(grade(original, changed, '确定要删除吗？', [
      { heading: '背景', level: 1 }, { missing: '第一阶段' }, { agentSaid: '吗|[?？]' }, { othersUnchanged: ['背景', '第一阶段'] },
    ]).pass).toBe(true);
    expect(grade(original, changed, '好的', [{ agentSaid: '吗' }, { exists: '第一阶段' }]).failures).toHaveLength(2);
  });

  it('measures transcript errors per character, ignoring spaces and punctuation', () => {
    expect(characterErrorRate('把第一段加粗', '把第一段加粗。')).toBe(0);
    expect(characterErrorRate('把第一段加粗', '把第二段加粗')).toBeCloseTo(1 / 6);
    expect(characterErrorRate('把 budget 那一节', '把Budget那一节')).toBe(0);
  });

  it('ships a case file whose checks all use known keys', () => {
    const keys = ['marked', 'notMarked', 'exists', 'missing', 'inSection', 'last', 'tableInSection', 'heading', 'inList', 'agentSaid', 'othersUnchanged', 'unchanged'];
    expect(cases.cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.cases.map(c => c.id)).size).toBe(cases.cases.length);
    for (const c of cases.cases as { id: string; utterances: string[]; turnChecks?: Check[][]; checks: Check[] }[]) {
      expect(c.utterances.length).toBeGreaterThan(0);
      const turnChecks = c.turnChecks ?? [];
      expect(turnChecks.length).toBeLessThan(c.utterances.length);
      for (const check of [...c.checks, ...turnChecks.flat()]) expect(keys.some(key => key in check)).toBe(true);
      // An agent that never edits must fail every case that asks for an edit at some turn.
      const asksForEdit = (checks: Check[]) => checks.some(check => !('unchanged' in check) && !('othersUnchanged' in check) && !('agentSaid' in check) && !('exists' in check));
      if ([c.checks, ...turnChecks].some(asksForEdit)) {
        expect([c.checks, ...turnChecks].some(checks => !grade(original, original, '', checks).pass), c.id).toBe(true);
      }
    }
  });
});
