import type { Editor } from '@tiptap/core';
import { colorToHex } from '../../domain/text/color';
import { selectedParagraphs } from './paragraph-selection';

export type ParagraphBackground = string | null;
export function selectedParagraphBackground(editor: Editor): ParagraphBackground {
  const values = selectedParagraphs(editor.state.doc, editor.state.selection).map(({ node }) => colorToHex(node.attrs.paragraphBackground));
  return values.every(value => value === values[0]) ? values[0] ?? null : 'mixed';
}

export function paragraphBackgroundAttribute() {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => colorToHex(element.style.backgroundColor),
    renderHTML: (attrs: Record<string, unknown>) => {
      const color = colorToHex(attrs.paragraphBackground);
      return color ? { style: `background-color:${color}` } : {};
    },
  };
}
