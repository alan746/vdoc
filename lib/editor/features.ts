import { Node, mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
export const LocalImage = Image.extend({
  addAttributes() { return { ...this.parent?.(),
    width: { default: 320, parseHTML: el => Number(el.getAttribute('width')) || 320,
      renderHTML: a => ({ width: a.width, ...(a.width > 0 && a.height > 0 ? { style: `aspect-ratio: ${a.width} / ${a.height}` } : {}) }) },
    height: { default: null, parseHTML: el => { const value = Number(el.getAttribute('height')); return Number.isFinite(value) && value > 0 ? value : null; },
      renderHTML: a => a.height > 0 ? { height: a.height } : {} },
  }; },
  addNodeView() {
    const render = this.parent?.(); if (!render) return null;
    return props => {
      const view = render(props), update = view.update?.bind(view);
      // The resize view manages dimensions outside HTML attributes. Synchronize
      // them after property changes and undo, not just after pointer movement.
      view.update = (node, decorations, innerDecorations) => {
        const accepted = update?.(node, decorations, innerDecorations) ?? false;
        if (accepted) {
          const image = (view.dom as HTMLElement).querySelector('img');
          if (image) { image.style.width = node.attrs.width ? `${node.attrs.width}px` : ''; image.style.height = node.attrs.height ? `${node.attrs.height}px` : ''; }
        }
        return accepted;
      };
      return view;
    };
  },
}).configure({ allowBase64: true, resize: { enabled: true, directions: ['bottom-right', 'bottom-left'], minWidth: 40, minHeight: 20, alwaysPreserveAspectRatio: true } });
export const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-page-break]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' }), ['span', {}, 'Page break']]; },
});

export const Footnote = Node.create({
  name: 'footnote', group: 'inline', inline: true, atom: true,
  addAttributes() { return { text: { default: '', parseHTML: el => el.getAttribute('data-note') }, number: { default: 1, parseHTML: el => Number(el.textContent) || 1 } }; },
  parseHTML() { return [{ tag: 'sup[data-note]', priority: 100 }]; },
  renderHTML({ node }) { return ['sup', { 'data-note': node.attrs.text, title: node.attrs.text, class: 'footnote-ref' }, String(node.attrs.number)]; },
});
export const TableOfContents = Node.create({
  name: 'tableOfContents', group: 'block', atom: true,
  addAttributes() { return { items: { default: [] } }; },
  parseHTML() { return [{ tag: 'nav[data-table-of-contents]' }]; },
  renderHTML({ node }) { return ['nav', { 'data-table-of-contents': '', class: 'document-toc' }, ['strong', {}, 'Contents'], ...node.attrs.items.map((item: { text: string; level: number }) => ['div', { style: `padding-left:${(item.level - 1) * 16}px` }, item.text])]; },
});
