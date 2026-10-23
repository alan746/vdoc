import Code from '@tiptap/extension-code';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import { styles } from './styles';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { FormatOverride, VdocBold, VdocUnderline } from './format-overrides';
import { textCommands } from './commands';
import { markRule } from './validation';
import type { EditorFeature } from '../feature';

export const formatFeature = {
  id: 'format',
  extensions: () => [
    { order: 200, value: FormatOverride },
    { order: 300, value: VdocBold },
    { order: 400, value: VdocUnderline },
    { order: 602, value: Code },
    { order: 609, value: Italic },
    { order: 611, value: Link.configure({ openOnClick: false }) },
    { order: 612, value: Strike },
    { order: 1400, value: TextStyleKit.configure({ backgroundColor: false, lineHeight: false }) },
    { order: 1600, value: Highlight.configure({ multicolor: true }) },
    { order: 1700, value: Superscript },
    { order: 1800, value: Subscript },
  ],
  css: styles,
  commands: textCommands,
  validation: [{ order: 800, value: markRule }],
} satisfies EditorFeature;
