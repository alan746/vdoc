import type { NodeRule } from '../../domain/rules/document-validation';
import { validColor } from '../validation-values';

export const markRule: NodeRule = node => {
    for (const mark of node.marks || []) {
      if (!mark || typeof mark !== 'object' || Array.isArray(mark) || typeof mark.type !== 'string') throw new Error('The backup contains invalid text formatting.');
      if (mark.type === 'formatOverride' && ((mark.attrs != null && (typeof mark.attrs !== 'object' || Array.isArray(mark.attrs))) || Object.keys(mark.attrs || {}).some(key => !['boldOff', 'underlineOff'].includes(key)) || ['boldOff', 'underlineOff'].some(key => mark.attrs?.[key] !== undefined && typeof mark.attrs[key] !== 'boolean'))) throw new Error('The backup contains invalid format overrides.');
      if (mark.type === 'link' && !/^(https?:\/\/|mailto:)/i.test(mark.attrs?.href || '')) throw new Error('The backup contains an unsupported link.');
      if (!validColor(mark.attrs?.color)) throw new Error('The backup contains an invalid text color.');
    }
};
