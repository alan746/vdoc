import type { JSONContent } from '@tiptap/core';

/** The document every case starts from. Checks find blocks by these texts, never by IDs. */
export const FIXTURE_TITLE = '项目计划';

const heading = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });

export const FIXTURE_TEXTS = {
  title: '项目计划',
  intro: '本项目旨在改进语音编辑体验。',
  background: '背景',
  need: '用户希望用说话的方式修改文档。',
  pain: '现有工具需要大量鼠标操作。',
  progress: '进度',
  phase1: '第一阶段已经完成。',
  budget: '预算',
  total: '预算总额为十万元。',
} as const;

export function fixtureDocument(): JSONContent {
  const t = FIXTURE_TEXTS;
  return {
    type: 'doc',
    content: [
      heading(1, t.title), paragraph(t.intro),
      heading(2, t.background), paragraph(t.need), paragraph(t.pain),
      heading(2, t.progress), paragraph(t.phase1),
      heading(2, t.budget), paragraph(t.total),
    ],
  };
}
