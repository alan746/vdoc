export const orderedStyles = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as const;
export const bulletStyles = ['disc', 'circle', 'square'] as const;
export const listStyles = [...orderedStyles, ...bulletStyles] as const;
export type ListStyle = typeof listStyles[number];
export const htmlNumberTypes = ['1', 'a', 'A', 'i', 'I'] as const;
export const orderedStyle = (type: unknown) => orderedStyles[Math.max(0, htmlNumberTypes.indexOf(type as typeof htmlNumberTypes[number]))];
export const orderedType = (style: string) => htmlNumberTypes[Math.max(0, orderedStyles.indexOf(style as typeof orderedStyles[number]))];
export const bulletGlyphs = { disc: '•', circle: '○', square: '▪' } as const;
