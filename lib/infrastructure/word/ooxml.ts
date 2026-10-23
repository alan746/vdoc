// Shared WordprocessingML (OOXML) helpers for the DOCX import pipeline.

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** First direct child element `w:<name>`, if any. */
export const child = (parent: Element | null | undefined, name: string) =>
  parent ? Array.from(parent.children).find(node => node.namespaceURI === W && node.localName === name) : undefined;

/** A `w:` attribute (default `w:val`); an empty string is returned as-is. */
export const attr = (node: Element | null | undefined, name = 'val') => node?.getAttributeNS(W, name) ?? undefined;

/** Adds a conversion warning once. */
export const warn = (warnings: string[], message: string) => { if (!warnings.includes(message)) warnings.push(message); };
