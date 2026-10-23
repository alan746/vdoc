import Blockquote from '@tiptap/extension-blockquote';
import CodeBlock from '@tiptap/extension-code-block';
import { Dropcursor, Gapcursor, UndoRedo, TrailingNode } from '@tiptap/extensions';
import HardBreak from '@tiptap/extension-hard-break';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Text from '@tiptap/extension-text';
import { styles } from './styles';
import { documentCommands } from './commands';
import Document from '@tiptap/extension-document';
import Placeholder from '@tiptap/extension-placeholder';
import { NativeSelectionSync } from '../native-selection';
import { StableIds } from './stable-ids';
import { pageRule, languageRule, textMetadataRule, layoutValuesRule } from './validation';
import type { EditorFeature } from '../feature';

export const documentFeature = {
  id: 'document',
  blockIdTypes: ['blockquote'],
  extensions: ({ blockIdTypes }) => [
    { order: 0, value: NativeSelectionSync },
    { order: 500, value: Document.extend({ addAttributes() { return { language: { default: 'und' }, pageSize: { default: 'a4' }, orientation: { default: 'portrait' }, pageMargin: { default: 20 }, pageColor: { default: '#FFFFFF' }, header: { default: '' }, footer: { default: '' }, pageNumbers: { default: false } }; } }) },
    { order: 601, value: Blockquote },
    { order: 603, value: CodeBlock },
    { order: 604, value: Dropcursor },
    { order: 605, value: Gapcursor },
    { order: 606, value: HardBreak },
    { order: 607, value: UndoRedo },
    { order: 608, value: HorizontalRule },
    { order: 613, value: Text },
    { order: 614, value: TrailingNode },
    { order: 3200, value: StableIds.configure({ types: [...(blockIdTypes ?? [])] }) },
    { order: 3400, value: Placeholder.configure({ placeholder: 'Start writing here…', showOnlyCurrent: true }) },
  ],
  css: styles,
  commands: documentCommands,
  validation: [{ order: 100, value: pageRule }, { order: 510, value: languageRule }, { order: 530, value: textMetadataRule }, { order: 610, value: layoutValuesRule }],
} satisfies EditorFeature;
