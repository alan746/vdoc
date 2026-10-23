import type { NodeRule } from '../../domain/rules/document-validation';
import { paragraphBordersSchema } from '../../domain/rules/paragraph-borders';
import { validTabInterval } from '../../domain/rules/tab-interval';
import { HEX_COLOR } from '../../domain/text/color';

export const paragraphRule: NodeRule = (node, attrs) => {
    if (attrs.paragraphBorderJoin !== undefined && typeof attrs.paragraphBorderJoin !== 'boolean') throw new Error('The backup contains an invalid paragraph border grouping.');
    if (attrs.paragraphBorders != null && !paragraphBordersSchema.safeParse(attrs.paragraphBorders).success) throw new Error('The backup contains invalid paragraph borders.');
    if (attrs.paragraphBackground != null && (typeof attrs.paragraphBackground !== 'string' || !HEX_COLOR.test(attrs.paragraphBackground))) throw new Error('The backup contains an invalid paragraph background.');
    if (attrs.tabInterval !== undefined && !validTabInterval(attrs.tabInterval)) throw new Error('The backup contains an invalid tab interval.');
    for (const key of ['indentStart','indentEnd','firstLineIndent']) if (attrs[key] !== undefined && !(key==='indentStart' && attrs[key]===null) && (typeof attrs[key] !== 'number' || !Number.isFinite(attrs[key]) || Math.abs(attrs[key])>10000)) throw new Error('The backup contains invalid paragraph indentation.');
};

export const paragraphPaginationRule: NodeRule = (node, attrs) => {
    if (['paragraph','heading'].includes(node.type || '')) for (const key of ['keepWithNext','keepLinesTogether','preventSingleLines']) {
      if (attrs[key] !== undefined && !(key === 'keepWithNext' && attrs[key] === null) && typeof attrs[key] !== 'boolean') throw new Error('The backup contains an invalid paragraph page-break setting.');
    }
};
