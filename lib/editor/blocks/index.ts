import { styles } from './styles';
import { LocalImage, PageBreak, Footnote, TableOfContents } from './extensions';
import { ReferenceSync } from './reference-sync';
import { blockCommands } from './commands';
import { embeddedBlockRule } from './validation';
import type { EditorFeature } from '../feature';

export const blocksFeature = {
  id: 'blocks',
  blockIdTypes: ['image', 'pageBreak', 'tableOfContents'],
  extensions: () => [
    { order: 2400, value: LocalImage },
    { order: 2500, value: PageBreak },
    { order: 2600, value: Footnote },
    { order: 2700, value: TableOfContents },
    { order: 3300, value: ReferenceSync },
  ],
  css: styles,
  commands: blockCommands,
  validation: [{ order: 700, value: embeddedBlockRule }],
} satisfies EditorFeature;
