import { styles } from './styles';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import TextAlign from '@tiptap/extension-text-align';
import { preserveTabWhitespace } from './paragraph-tabs';
import { ParagraphLayout } from './extensions';
import { ParagraphBorderGroups, PARAGRAPH_BORDER_GROUP_CSS } from './paragraph-border-groups';
import { paragraphCommands } from './commands';
import { paragraphRule, paragraphPaginationRule } from './validation';
import type { EditorFeature } from '../feature';

export const paragraphFeature = {
  id: 'paragraph',
  blockIdTypes: ['paragraph', 'heading'],
  extensions: () => [
    { order: 700, value: Paragraph.extend({ parseHTML() { return [{ tag: 'p', getAttrs: preserveTabWhitespace, preserveWhitespace: 'full' }, ...(this.parent?.() || [])]; } }) },
    { order: 800, value: Heading.extend({ parseHTML() { return [...this.options.levels.map(level => ({ tag: `h${level}`, getAttrs: (el: HTMLElement) => preserveTabWhitespace(el) === false ? false : { level }, preserveWhitespace: 'full' as const })), ...(this.parent?.() || [])]; } }).configure({ levels: [1, 2, 3, 4, 5, 6] }) },
    { order: 1500, value: TextAlign.configure({ types: ['heading', 'paragraph'] }) },
    { order: 3000, value: ParagraphBorderGroups },
    { order: 3100, value: ParagraphLayout },
  ],
  commands: paragraphCommands,
  validation: [{ order: 300, value: paragraphRule }, { order: 410, value: paragraphPaginationRule }],
  css: [...styles, { order: 10000, value: PARAGRAPH_BORDER_GROUP_CSS }],
} satisfies EditorFeature;
