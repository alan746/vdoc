/** Decode text without silently replacing undecodable bytes with U+FFFD.
 * UTF-16 is selected only by its BOM; guessing an unmarked legacy encoding can
 * produce plausible but incorrect text, so UTF-8 remains the default.
 */
export function decodeTextFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const invalid = () => new Error('This text file could not be decoded without losing characters. Save it as UTF-8 and import it again.');
  // A UTF-32 LE signature also begins with the UTF-16 LE signature.
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) throw invalid();
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    // Unmarked UTF-16 ASCII is valid UTF-8 containing NULs. Do not import it as
    // seemingly successful text with invisible characters between every letter.
    if (text.includes('\0')) throw invalid();
    return text;
  } catch { throw invalid(); }
}
