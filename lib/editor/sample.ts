export const initialContent = {
  type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'PRODUCT / 01', marks: [{ type: 'textStyle', attrs: { color: '#68778D', fontSize: '12px' } }] }] },
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '把想法，写成下一步。' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'VDoc 项目计划', marks: [{ type: 'textStyle', attrs: { color: '#68778D', fontSize: '18px' } }] }] },
    { type: 'horizontalRule' },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '项目概览' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: '好的文档，让想法更清晰。我们希望为每一次思考，提供一个' },
      { type: 'text', text: '安静、流畅、可靠', marks: [{ type: 'highlight', attrs: { color: '#FFF0AD' } }] },
      { type: 'text', text: '的书写空间。从一句灵感开始，逐渐整理成可以执行的计划。' },
    ] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '我们关注什么' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '自然书写', marks: [{ type: 'bold' }] }, { type: 'text', text: ' — 让输入、选择和修改都顺手。' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '清晰表达', marks: [{ type: 'bold' }] }, { type: 'text', text: ' — 用标题、列表和表格组织复杂的信息。' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '安心编辑', marks: [{ type: 'bold' }] }, { type: 'text', text: ' — 每一次修改，都可以从容撤销。' }] }] },
    ] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '阶段安排' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: ['阶段', '重点工作', '交付成果'].map(text => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
      ...[['01 · 基础', '编辑与排版', '可用的文档工作台'], ['02 · 体验', '选择、表格与撤销', '顺畅的编辑体验'], ['03 · 验证', '实际文档测试', '稳定的第一版']].map(row => ({ type: 'tableRow', content: row.map(text => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) })),
    ] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '下一步' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '选中一段文字，试试上方的格式工具；也可以直接开始写下你的想法。' }] },
  ],
};
