import type { NodeRule } from '../../domain/rules/document-validation';
import { canonicalLanguage } from '../../domain/text/language';
import { validColor } from '../validation-values';

export const pageRule: NodeRule = (node, attrs) => {
    if (node.type === 'doc') {
      // Match Page setup / document.layout. Unsupported backup settings must
      // not silently become A4 portrait or an unprintable page on export.
      if (attrs.pageSize !== undefined && !['a4', 'letter'].includes(attrs.pageSize)) throw new Error('The backup contains an unsupported page size. VDoc supports A4 and Letter.');
      if (attrs.orientation !== undefined && !['portrait', 'landscape'].includes(attrs.orientation)) throw new Error('The backup contains an invalid page orientation.');
      if (attrs.pageMargin !== undefined && (!Number.isInteger(attrs.pageMargin) || attrs.pageMargin < 5 || attrs.pageMargin > 50)) throw new Error('The backup contains unsupported page margins. Use a whole number from 5 to 50 mm.');
      if (attrs.pageNumbers !== undefined && typeof attrs.pageNumbers !== 'boolean') throw new Error('The backup contains an invalid page-number setting.');
    }
};

export const languageRule: NodeRule = (node, attrs) => {
    if (node.type === 'doc' && attrs.language != null && !canonicalLanguage(attrs.language)) throw new Error('The backup contains an invalid document language.');
};

export const textMetadataRule: NodeRule = (node, attrs) => {
    if (attrs.direction != null && !['auto','ltr','rtl'].includes(attrs.direction)) throw new Error('The backup contains an invalid text direction.');
    for (const key of ['header','footer','alt']) if (attrs[key] != null && typeof attrs[key] !== 'string') throw new Error('The backup contains invalid text metadata.');
};

export const layoutValuesRule: NodeRule = (node, attrs) => {
    for (const key of ['backgroundColor', 'borderColor', 'pageColor']) if (!validColor(attrs[key])) throw new Error('The backup contains an invalid color.');
    for (const key of ['colspan', 'rowspan', 'width', 'height', 'minHeight', 'padding', 'borderWidth', 'indent', 'spaceBefore', 'spaceAfter', 'pageMargin']) {
      if (attrs[key] != null && (typeof attrs[key] !== 'number' || !Number.isFinite(attrs[key]) || attrs[key] < 0 || attrs[key] > 10000)) throw new Error('The backup contains an invalid layout value.');
    }
};
