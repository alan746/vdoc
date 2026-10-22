import type JSZip from 'jszip';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export type WordAttributes = Record<string, string>;
const hex = (value?: string) => value && /^[\da-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;

// Word applies tint/shade to HSL luminance, rather than independently to RGB.
function luminance(hexColor: string, shade?: string, tint?: string) {
  const [r, g, b] = hexColor.match(/../g)!.map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let light = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue /= 6;
  if (tint && /^[\da-f]{2}$/i.test(tint)) light = 1 - (1 - light) * parseInt(tint, 16) / 255;
  else if (shade && /^[\da-f]{2}$/i.test(shade)) light *= parseInt(shade, 16) / 255;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat, x = chroma * (1 - Math.abs(hue * 6 % 2 - 1)), m = light - chroma / 2;
  const rgb = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x] : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x];
  return rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function script(language: string | undefined, text: string): string | undefined {
  if (language?.startsWith('zh')) return /(?:TW|HK|MO|Hant)/i.test(language) ? 'Hant' : 'Hans';
  const tags: Record<string, string> = { ja: 'Jpan', ko: 'Hang', ar: 'Arab', fa: 'Arab', ur: 'Arab', he: 'Hebr', hi: 'Deva', mr: 'Deva', bn: 'Beng', th: 'Thai', ta: 'Taml', te: 'Telu', gu: 'Gujr', pa: 'Guru', kn: 'Knda', ml: 'Mlym', km: 'Khmr', lo: 'Laoo', my: 'Mymr' };
  const tag = tags[language?.split('-')[0] || '']; if (tag) return tag;
  if (/[\u3040-\u30ff]/u.test(text)) return 'Jpan';
  if (/[\uac00-\ud7af]/u.test(text)) return 'Hang';
  if (/[\u3400-\u9fff\u{20000}-\u{3134f}]/u.test(text)) return 'Hans';
  if (/[\u0590-\u05ff]/u.test(text)) return 'Hebr';
  if (/[\u0600-\u08ff]/u.test(text)) return 'Arab';
  if (/[\u0900-\u097f]/u.test(text)) return 'Deva';
}

export async function wordTheme(zip: JSZip, settings: Document | null, warnings: string[]) {
  const warn = () => { const message = 'Some Word theme fonts or colors could not be resolved. Explicit fallback values are used where available; review text appearance.'; if (!warnings.includes(message)) warnings.push(message); };
  const relsRaw = await zip.file('word/_rels/document.xml.rels')?.async('string');
  const rels = relsRaw ? new DOMParser().parseFromString(relsRaw, 'application/xml') : null;
  const rel = Array.from(rels?.documentElement.children || []).find(n => n.getAttribute('Type')?.endsWith('/theme'));
  let raw: string | undefined;
  if (rel && rel.getAttribute('TargetMode') !== 'External') {
    const target = rel.getAttribute('Target') || '';
    const parts: string[] = target.startsWith('/') ? [] : ['word'];
    for (const part of target.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    raw = await zip.file(parts.join('/'))?.async('string');
  }
  if (raw && raw.length > 20_000_000) throw new Error('The Word theme is too large to import.');
  const theme = raw ? new DOMParser().parseFromString(raw, 'application/xml') : null;
  const colors = new Map<string, string>();
  for (const role of Array.from(theme?.getElementsByTagNameNS(A, 'clrScheme')[0]?.children || [])) {
    const value = role.firstElementChild;
    const color = hex(value?.getAttribute(value.localName === 'sysClr' ? 'lastClr' : 'val') || undefined);
    if (color) colors.set(role.localName, color);
  }
  const mapping = settings?.getElementsByTagNameNS(W, 'clrSchemeMapping')[0];
  const aliases: Record<string, string> = { dark1: 'dk1', dark2: 'dk2', light1: 'lt1', light2: 'lt2', text1: 'dk1', text2: 'dk2', background1: 'lt1', background2: 'lt2', t1: 'dk1', t2: 'dk2', bg1: 'lt1', bg2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink' };
  return {
    color(attrs: WordAttributes | undefined, fill = false): string | undefined {
      if (!attrs) return;
      const key = fill ? 'themeFill' : 'themeColor', role = attrs[key];
      let color = hex(attrs[fill ? 'fill' : 'val']);
      if (role && role !== 'none') {
        const mapKey: Record<string, string> = { text1: 't1', text2: 't2', background1: 'bg1', background2: 'bg2', hyperlink: 'hyperlink', followedHyperlink: 'followedHyperlink' };
        const mapped = mapping?.getAttributeNS(W, mapKey[role] || role) || role;
        const themed = colors.get(aliases[mapped] || mapped);
        if (themed) color = luminance(themed, attrs[fill ? 'themeFillShade' : 'themeShade'], attrs[fill ? 'themeFillTint' : 'themeTint']); else warn();
      }
      return color ? `#${color}` : undefined;
    },
    font(reference: string | undefined, language: string | undefined, text: string): string | undefined {
      if (!reference) return;
      const match = reference.match(/^(major|minor)(Ascii|HAnsi|EastAsia|Bidi)$/);
      if (!match) { warn(); return; }
      const group = theme?.getElementsByTagNameNS(A, `${match[1]}Font`)[0];
      const channel = match[2] === 'EastAsia' ? 'ea' : match[2] === 'Bidi' ? 'cs' : 'latin';
      let font = Array.from(group?.children || []).find(n => n.localName === channel)?.getAttribute('typeface') || undefined;
      if (!font && channel !== 'latin') {
        const code = script(language, text);
        font = Array.from(group?.children || []).find(n => n.localName === 'font' && n.getAttribute('script') === code)?.getAttribute('typeface') || undefined;
      }
      if (!font) warn(); return font;
    },
  };
}
export type WordTheme = Awaited<ReturnType<typeof wordTheme>>;
