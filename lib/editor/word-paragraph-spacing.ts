import { restoreWordLineSpacing } from './paragraph-line-height';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Spacing = Record<string, string>;
type PropertyName = 'spacing' | 'ind' | 'jc' | 'bidi' | 'keepNext' | 'keepLines' | 'widowControl' | 'shd' | 'outlineLvl';
export type WordParagraphProperties = Partial<Record<PropertyName, Spacing>> & { numbering?: { numId?: string; ilvl?: string }; borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left' | 'between' | 'bar', Spacing>> };
const child = (node: Element | null | undefined, name: string) => node ? Array.from(node.children).find(el => el.namespaceURI === W && el.localName === name) : undefined;
const attr = (node: Element | undefined, name: string) => node?.getAttributeNS(W, name) ?? undefined;
function properties(node: Element | undefined): WordParagraphProperties {
  const result: WordParagraphProperties = {};
  const numbering = child(node, 'numPr');
  if (numbering) {
    result.numbering = {};
    for (const key of ['numId', 'ilvl'] as const) {
      const value = attr(child(numbering, key), 'val');
      if (value !== undefined) result.numbering[key] = value;
    }
  }
  for (const key of ['spacing', 'ind', 'jc', 'bidi', 'keepNext', 'keepLines', 'widowControl', 'shd', 'outlineLvl'] as const) {
    const value = child(node, key);
    if (value) result[key] = Object.fromEntries(Array.from(value.attributes).filter(a => a.namespaceURI === W).map(a => [a.localName, a.value]));
  }
  const borders = child(node, 'pBdr');
  if (borders) {
    result.borders = {};
    for (const side of ['top', 'right', 'bottom', 'left', 'between', 'bar'] as const) {
      const edge = child(borders, side);
      if (edge) result.borders[side] = Object.fromEntries(Array.from(edge.attributes).filter(a => a.namespaceURI === W).map(a => [a.localName, a.value]));
    }
  }
  return result;
}
function merge(base: WordParagraphProperties, next: WordParagraphProperties): WordParagraphProperties {
  const result = { ...base, ...next };
  // Spacing/indent attributes inherit individually. An empty on/off element
  // instead means true, so it must replace its ancestor's explicit false.
  for (const key of ['spacing', 'ind'] as const) if (next[key]) result[key] = { ...base[key], ...next[key] };
  // Each border is inherited separately; an explicit edge replaces all of that
  // edge's parameters. nil/none must survive this merge to suppress an ancestor.
  if (next.borders) result.borders = { ...base.borders, ...next.borders };
  if (next.numbering) result.numbering = { ...base.numbering, ...next.numbering };
  return result;
}
const warn = (warnings: string[], message: string) => { if (!warnings.includes(message)) warnings.push(message); };

/** Resolve supported layout: defaults < basedOn chain < selected style < direct pPr. */
export function wordParagraphProperties(styles: Document | null, warnings: string[]) {
  const defaults = properties(child(child(child(styles?.documentElement, 'docDefaults'), 'pPrDefault'), 'pPr'));
  const definitions = new Map<string, Element>();
  let defaultStyle: string | undefined;
  for (const node of Array.from(styles?.documentElement.children || [])) {
    const id = attr(node, 'styleId');
    if (node.namespaceURI !== W || node.localName !== 'style' || attr(node, 'type') !== 'paragraph' || !id) continue;
    definitions.set(id, node);
    if (['1', 'true', 'on'].includes(attr(node, 'default') || '')) defaultStyle = id;
  }
  const cache = new Map<string, WordParagraphProperties>();
  function resolve(id: string | undefined): WordParagraphProperties {
    const path: string[] = [], seen = new Set<string>();
    let base = defaults;
    while (id) {
      if (seen.has(id) || !definitions.has(id)) {
        warn(warnings, 'Some Word paragraph style inheritance is cyclic or incomplete. Review imported paragraph layout.');
        break;
      }
      const cached = cache.get(id);
      if (cached) { base = cached; break; }
      seen.add(id); path.push(id);
      id = attr(child(definitions.get(id), 'basedOn'), 'val');
    }
    for (const key of path.reverse()) {
      const definition = definitions.get(key), own = properties(child(definition, 'pPr'));
      // Some producers omit outlineLvl for built-in Heading styles. Keep their
      // established semantics as a fallback; explicit pPr still wins below.
      const heading = key.match(/^Heading([1-6])$/) || attr(child(definition, 'name'), 'val')?.match(/^heading ?([1-6])$/i);
      if (!own.outlineLvl && heading) own.outlineLvl = {val:String(Number(heading[1]) - 1)};
      base = merge(base, own);
      cache.set(key, base);
    }
    return base;
  }
  return (paragraph: Element): WordParagraphProperties => {
    const direct = child(paragraph, 'pPr'), selected = attr(child(direct, 'pStyle'), 'val');
    const inherited = resolve(selected && definitions.has(selected) ? selected : defaultStyle);
    return merge(inherited, properties(direct));
  };
}

export function restoreParagraphSpacing(target: HTMLElement, values: Spacing, warnings: string[]) {
  const unsupported = () => warn(warnings, 'Some Word paragraph spacing uses automatic, line-based, or unsupported values. Review paragraph spacing after import.');
  for (const side of ['before', 'after'] as const) {
    const property = side === 'before' ? 'marginTop' : 'marginBottom';
    if (['1', 'true', 'on'].includes(values[`${side}Autospacing`])) { unsupported(); continue; }
    const lines = values[`${side}Lines`];
    if (lines !== undefined) {
      if (/^0+$/.test(lines)) target.style[property] = '0px'; else unsupported();
      continue;
    }
    if (values[side] === undefined) continue;
    const twips = Number(values[side]);
    if (!/^\d+$/.test(values[side]) || !Number.isSafeInteger(twips) || twips > 150000) { unsupported(); continue; }
    target.style[property] = `${twips / 15}px`;
  }
  restoreWordLineSpacing(target, values.line, values.lineRule, warnings);
}
