import type { NodeRule } from '../../domain/rules/document-validation';

export const embeddedBlockRule: NodeRule = (node, attrs) => {
    if (node.type === 'tableOfContents' && attrs.items != null && (!Array.isArray(attrs.items) || attrs.items.some((item: { text: unknown; level: unknown }) => !item || typeof item.text !== 'string' || typeof item.level !== 'number' || item.level < 1 || item.level > 6))) throw new Error('The contents block is invalid.');
    if (node.type === 'footnote' && typeof attrs.text !== 'string') throw new Error('The footnote is invalid.');
    if (node.type === 'image' && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(node.attrs?.src || '')) throw new Error('Images must be embedded in this local document.');
};
