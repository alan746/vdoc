import { wordShading } from './word-decoration';
import type { WordAttributes, WordTheme } from './word-theme';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Properties = Record<string, WordAttributes>;
const child = (node: Element | undefined | null, name: string) => Array.from(node?.children || []).find(n => n.namespaceURI === W && n.localName === name);
const value = (node: Element | undefined, key = 'val') => node?.getAttributeNS(W, key) ?? undefined;
const toggles = new Set(['b', 'i', 'strike', 'bCs', 'iCs']);
const enabled = (v: WordAttributes | undefined) => !!v && !['false', '0', 'off', 'none'].includes(v.val || '1');
function read(node: Element | undefined): Properties {
  const result: Properties = {};
  for (const name of ['rFonts', 'sz', 'szCs', 'color', 'shd', 'highlight', 'b', 'i', 'strike', 'bCs', 'iCs', 'u', 'vertAlign', 'cs', 'rtl', 'lang']) {
    const el = child(node, name);
    if (el) result[name] = Object.fromEntries(Array.from(el.attributes).filter(a => a.namespaceURI === W).map(a => [a.localName, a.value]));
  }
  return result;
}
function merge(base: Properties, next: Properties, style: boolean): Properties {
  const result = { ...base };
  for (const [key, attrs] of Object.entries(next)) {
    if (style && toggles.has(key)) {
      if (enabled(attrs)) result[key] = { val: String(!enabled(base[key])) };
    } else if (key === 'rFonts') {
      const fonts = { ...base.rFonts, ...attrs };
      for (const [font, theme] of [['ascii', 'asciiTheme'], ['hAnsi', 'hAnsiTheme'], ['eastAsia', 'eastAsiaTheme'], ['cs', 'cstheme']]) {
        if (attrs[font] !== undefined && attrs[theme] === undefined) delete fonts[theme];
        if (attrs[theme] !== undefined && attrs[font] === undefined) delete fonts[font];
      }
      result[key] = fonts;
    } else if (key === 'lang') result[key] = { ...base[key], ...attrs };
    else result[key] = attrs;
  }
  return result;
}

type Channel = 'ascii' | 'hAnsi' | 'eastAsia' | 'cs';
function fontChannel(text: string, properties: Properties): Channel {
  if (enabled(properties.cs) || enabled(properties.rtl)) return 'cs';
  const point = text.codePointAt(0)!;
  const hint = properties.rFonts?.hint === 'eastAsia', chinese = /^zh(?:-|$)/i.test(properties.lang?.eastAsia || properties.lang?.val || '');
  if (point <= 0x7f || point >= 0x590 && point <= 0x7bf || point >= 0xfb1d && point <= 0xfdff || point >= 0xfe70 && point <= 0xfefe) return 'ascii';
  if (point >= 0x1100 && point <= 0x11ff || point >= 0x2f00 && point <= 0x4dbf || point >= 0x4e00 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7af || point >= 0xf900 && point <= 0xfaff || point >= 0xfe30 && point <= 0xfe6f || point >= 0xff00 && point <= 0xffef || point >= 0x20000 && point <= 0x3134f) return 'eastAsia';
  if (hint && (point >= 0x2b0 && point <= 0x4ff || point >= 0x2000 && point <= 0x27bf || point >= 0x2e80 && point <= 0x2eff || point >= 0xe000 && point <= 0xf8ff || point >= 0xfb00 && point <= 0xfb1c || chinese && (point >= 0x100 && point <= 0x2af || point >= 0x1e00 && point <= 0x1eff))) return 'eastAsia';
  if (hint && (/[¡¤§¨ª\u00ad¯°±²³´¶·¸¹º¼½¾¿×÷]/u.test(text) || chinese && /[àáèéêìíòóùúü]/u.test(text))) return 'eastAsia';
  return 'hAnsi';
}
const highlights: Record<string, string> = { yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF' };
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function wordRunFormatter(styles: Document | null, theme: WordTheme, warnings: string[]) {
  const defaults = read(child(child(child(styles?.documentElement, 'docDefaults'), 'rPrDefault'), 'rPr'));
  const definitions = new Map<string, Element>(), defaultStyle: Record<string, string> = {};
  for (const node of Array.from(styles?.documentElement.children || [])) {
    const type = value(node, 'type'), id = value(node, 'styleId');
    if (node.namespaceURI !== W || node.localName !== 'style' || !id || !['paragraph', 'character'].includes(type || '')) continue;
    definitions.set(`${type}:${id}`, node);
    if (['1', 'true', 'on'].includes(value(node, 'default') || '')) defaultStyle[type!] = id;
  }
  const cache = new Map<string, Properties>();
  function resolve(id: string | undefined, type: string): Properties {
    let props: Properties = {};
    const path: string[] = [], seen = new Set<string>();
    while (id) {
      const key = `${type}:${id}`;
      if (seen.has(key) || !definitions.has(key)) {
        const message = 'Some Word text style inheritance is cyclic or incomplete. Review imported text formatting.';
        if (!warnings.includes(message) && !(type === 'paragraph' && warnings.some(warning => warning.includes('paragraph style inheritance')))) warnings.push(message);
        break;
      }
      const cached = cache.get(key); if (cached) { props = cached; break; }
      seen.add(key); path.push(key); id = value(child(definitions.get(key), 'basedOn'));
    }
    for (const key of path.reverse()) { props = merge(props, read(child(definitions.get(key), 'rPr')), true); cache.set(key, props); }
    return props;
  }
  const paragraphs = new WeakMap<Element, Properties>(), runs = new WeakMap<Element, Properties>();
  function effective(run: Element, paragraph: Element) {
    const cached = runs.get(run); if (cached) return cached;
    let base = paragraphs.get(paragraph);
    if (!base) {
      const selected = value(child(child(paragraph, 'pPr'), 'pStyle'));
      const id = selected && definitions.has(`paragraph:${selected}`) ? selected : defaultStyle.paragraph;
      base = merge(defaults, resolve(id, 'paragraph'), true); paragraphs.set(paragraph, base);
    }
    const direct = child(run, 'rPr'), selected = value(child(direct, 'rStyle'));
    const id = selected && definitions.has(`character:${selected}`) ? selected : defaultStyle.character;
    const result = merge(merge(base, resolve(id, 'character'), true), read(direct), false);
    runs.set(run, result); return result;
  }
  return (html: Document, run: Element, paragraph: Element, text: string, defaultBold = false): DocumentFragment => {
    const props = effective(run, paragraph), fonts = props.rFonts || {}, fragment = html.createDocumentFragment();
    const fontFor = (channel: Channel, text: string) => {
      const reference = fonts[channel === 'cs' ? 'cstheme' : `${channel}Theme`];
      const language = props.lang?.[channel === 'cs' ? 'bidi' : channel === 'eastAsia' ? 'eastAsia' : 'val'] || props.lang?.val;
      return (reference ? theme.font(reference, language, text) : undefined) || fonts[channel];
    };
    const color = theme.color(props.color), fill = highlights[props.highlight?.val] || wordShading(props.shd, theme, warnings);
    const parts: { text: string; font: string | undefined; complex: boolean }[] = [];
    for (const { segment } of segmenter.segment(text)) {
      let channel = fontChannel(segment, props);
      let font = fontFor(channel, segment);
      if (channel === 'eastAsia' && font === 'Times New Roman') {
        const ascii = fontFor('ascii', segment), ansi = fontFor('hAnsi', segment);
        if (ascii && ascii === ansi) { font = ascii; channel = 'ascii'; }
      }
      const complex = channel === 'cs';
      const last = parts.at(-1);
      if (last && last.font === font && last.complex === complex) last.text += segment; else parts.push({ text: segment, font, complex });
    }
    for (const part of parts) {
      const span = html.createElement('span'); span.textContent = part.text;
      if (part.font) span.style.fontFamily = part.font;
      const size = props[part.complex && props.szCs ? 'szCs' : 'sz']?.val;
      if (size && /^\d+$/.test(size) && Number(size) > 0 && Number(size) <= 20000) span.style.fontSize = `${Number(size) * 2 / 3}px`;
      if (color) span.style.color = color;
      let wrapper: Element = span;
      for (const [key, tag] of [[part.complex ? 'bCs' : 'b', 'strong'], [part.complex ? 'iCs' : 'i', 'em'], ['u', 'u'], ['strike', 's']]) {
        if (enabled(props[key])) { const parent = html.createElement(tag); parent.appendChild(wrapper); wrapper = parent; }
      }
      const script = props.vertAlign?.val;
      if (script === 'superscript' || script === 'subscript') { const parent = html.createElement(script === 'superscript' ? 'sup' : 'sub'); parent.appendChild(wrapper); wrapper = parent; }
      if (fill) { const mark = html.createElement('mark'); mark.style.backgroundColor = fill; mark.setAttribute('data-color', fill); mark.appendChild(wrapper); wrapper = mark; }
      const boldKey = part.complex ? 'bCs' : 'b';
      const boldOff = defaultBold && !!props[boldKey] && !enabled(props[boldKey]);
      let link = run.parentElement; while (link && link !== paragraph && link.localName !== 'hyperlink') link = link.parentElement;
      const underlineOff = link?.localName === 'hyperlink' && !!props.u && !enabled(props.u);
      if (boldOff || underlineOff) {
        const override = html.createElement('span'); override.setAttribute('data-vdoc-format-override', '');
        if (boldOff) { override.setAttribute('data-bold-off', 'true'); override.style.fontWeight = '400'; }
        if (underlineOff) override.setAttribute('data-underline-off', 'true');
        override.appendChild(wrapper); wrapper = override;
      }
      fragment.appendChild(wrapper);
    }
    return fragment;
  };
}
