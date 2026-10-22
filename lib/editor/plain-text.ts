import type { Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { bulletGlyphs } from './list-style';

function counter(value: number, type: unknown): string {
  if ((type === 'a' || type === 'A') && value > 0) {
    let result = '';
    for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return type === 'a' ? result.toLowerCase() : result;
  }
  if ((type === 'i' || type === 'I') && value > 0 && value <= 3999) {
    let result = '', remaining = value;
    for (const [amount, glyph] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const) {
      while (remaining >= amount) { result += glyph; remaining -= amount; }
    }
    return type === 'i' ? result.toLowerCase() : result;
  }
  return String(value);
}

// Quote multiline/tab-containing cells instead of deleting their whitespace.
const tableField = (text: string) => /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/** Readable UTF-8 text, without changing the editor or relying on DOM/CSS markers.
 * Tables follow document reading order: tabs between logical columns, newlines
 * between rows, and empty slots under/along merged cells. This is not a backup.
 */
export function exportPlainText(doc: Node): string {
  const notes: string[] = [];
  const children = (node: Node, separator: string): string => {
    const values: string[] = [];
    node.forEach(child => values.push(render(child)));
    return values.join(separator);
  };
  const renderTable = (table: Node): string => {
    const map = TableMap.get(table), rows: string[] = [];
    const cellNodes = new Map<number, Node>();
    // Resolve each cell once; repeated nodeAt lookups would rescan preceding rows.
    table.forEach((row, rowOffset) => row.forEach((cell, cellOffset) => cellNodes.set(rowOffset + cellOffset + 1, cell)));
    const seen = new Set<number>();
    for (let row = 0; row < map.height; row++) {
      const cells: string[] = [];
      for (let column = 0; column < map.width; column++) {
        const position = map.map[row * map.width + column];
        const cell = cellNodes.get(position);
        if (!cell || seen.has(position)) cells.push('');
        else { seen.add(position); cells.push(tableField(children(cell, '\n'))); }
      }
      rows.push(cells.join('\t'));
    }
    return rows.join('\n');
  };
  const renderList = (list: Node): string => {
    const items: string[] = [];
    list.forEach((item, _offset, index) => {
      const marker = list.type.name === 'taskList' ? (item.attrs.checked ? '[x]' : '[ ]')
        : list.type.name === 'orderedList' ? `${list.attrs.numberPrefix ?? ''}${counter((list.attrs.start ?? 1) + index, list.attrs.type)}${list.attrs.numberSuffix ?? '.'}`
          : list.attrs.bulletText || bulletGlyphs[list.attrs.bulletStyle as keyof typeof bulletGlyphs] || '•';
      const lines = children(item, '\n').split('\n');
      items.push(`${marker} ${lines[0]}${lines.slice(1).map(line => `\n  ${line}`).join('')}`);
    });
    return items.join('\n');
  };
  const render = (node: Node): string => {
    if (node.isText) return node.text || '';
    switch (node.type.name) {
      case 'hardBreak': return '\n';
      case 'paragraph': case 'heading': case 'codeBlock': return children(node, '');
      case 'table': return renderTable(node);
      case 'bulletList': case 'orderedList': case 'taskList': return renderList(node);
      case 'blockquote': return children(node, '\n\n').split('\n').map(line => `> ${line}`).join('\n');
      case 'image': return node.attrs.alt ? `[Image: ${node.attrs.alt}]` : '[Image]';
      case 'footnote': notes.push(node.attrs.text || ''); return `[${notes.length}]`;
      case 'tableOfContents': return ['Contents', ...(node.attrs.items || []).map((item: { text: string; level: number }) => `${'  '.repeat(Math.max(0, item.level - 1))}${item.text}`)].join('\n');
      case 'pageBreak': return '\f';
      case 'horizontalRule': return '---';
      default: return children(node, node.isInline ? '' : '\n\n');
    }
  };
  const body = render(doc);
  return [
    ...(doc.attrs.header ? [doc.attrs.header] : []), body,
    ...(notes.length ? [`Notes\n${notes.map((note, index) => `[${index + 1}] ${note}`).join('\n')}`] : []),
    ...(doc.attrs.footer ? [doc.attrs.footer] : []),
  ].join('\n\n');
}
