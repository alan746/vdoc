import type { NodeRule } from '../../domain/rules/document-validation';
import { validNumberAffix, validBulletText } from '../../domain/rules/list-markers';
import { htmlNumberTypes, bulletStyles } from '../../domain/rules/list-styles';
import { validListStart } from '../../domain/rules/list-numbering';

export const listRule: NodeRule = (node, attrs) => {
    if (node.type === 'bulletList' && attrs.bulletStyle !== undefined && !bulletStyles.includes(attrs.bulletStyle)) throw new Error('The backup contains an invalid bullet style.');
    if (node.type === 'bulletList' && attrs.bulletText != null && !validBulletText(attrs.bulletText)) throw new Error('The backup contains an invalid custom bullet.');
    if (node.type === 'taskList' && attrs.strikeCompleted !== undefined && typeof attrs.strikeCompleted !== 'boolean') throw new Error('The backup contains an invalid checklist style.');
    if (node.type === 'taskItem' && attrs.checked !== undefined && typeof attrs.checked !== 'boolean') throw new Error('The backup contains an invalid checklist state.');
    if (node.type === 'orderedList') {
      for (const key of ['numberPrefix','numberSuffix']) if (attrs[key] !== undefined && !validNumberAffix(attrs[key])) throw new Error('The backup contains an invalid numbering affix.');
      if (attrs.type != null && !htmlNumberTypes.includes(attrs.type)) throw new Error('The backup contains an invalid numbering style.');
      if (attrs.start !== undefined && !validListStart(attrs.start)) throw new Error('The backup contains an invalid list start.');
      if (attrs.continuePrevious !== undefined && typeof attrs.continuePrevious !== 'boolean') throw new Error('The backup contains an invalid numbering continuation.');
    }
};
