import { styles } from './styles';
import { SearchHighlights } from './search-highlights';
import { searchCommands } from './commands';
import type { EditorFeature } from '../feature';

export const searchFeature = {
  id: 'search',
  extensions: () => [
    { order: 100, value: SearchHighlights },
  ],
  css: styles,
  commands: searchCommands,
} satisfies EditorFeature;
