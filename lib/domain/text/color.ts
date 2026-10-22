/** Convert supported opaque CSS colors to a common palette value. */
export function colorToHex(value: unknown): string | null {
  if(typeof value !== 'string') return null;
  const input = value.trim();
  if(/^#[\da-f]{6}$/i.test(input)) return input.toUpperCase();
  if(/^#[\da-f]{3}$/i.test(input)) return `#${Array.from(input.slice(1), c=>c+c).join('').toUpperCase()}`;
  const match = input.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1(?:\.0+)?))?\s*\)$/i);
  if(!match || match.slice(1,4).some(n=>+n>255) || input.toLowerCase().startsWith('rgba') && !match[4]) return null;
  return `#${match.slice(1,4).map(n=>(+n).toString(16).padStart(2,'0')).join('').toUpperCase()}`;
}
