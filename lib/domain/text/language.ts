/** Canonical BCP 47 tags supported by the browser's locale parser. */
export function canonicalLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100 || !value.trim()) return null;
  try { return new Intl.Locale(value.trim()).toString(); } catch { return null; }
}
export const documentLanguages = [
  ['und','Not specified'], ['en','English'], ['zh-Hans','Chinese · 简体中文'], ['zh-Hant','Chinese · 繁體中文'], ['ja','Japanese · 日本語'], ['ko','Korean · 한국어'],
  ['ar','Arabic · العربية'], ['he','Hebrew · עברית'], ['fa','Persian · فارسی'], ['ur','Urdu · اردو'], ['hi','Hindi · हिन्दी'], ['bn','Bengali · বাংলা'],
  ['ta','Tamil · தமிழ்'], ['te','Telugu · తెలుగు'], ['kn','Kannada · ಕನ್ನಡ'], ['ml','Malayalam · മലയാളം'], ['gu','Gujarati · ગુજરાતી'], ['pa','Punjabi · ਪੰਜਾਬੀ'],
  ['ne','Nepali · नेपाली'], ['si','Sinhala · සිංහල'], ['th','Thai · ไทย'], ['lo','Lao · ລາວ'], ['km','Khmer · ខ្មែរ'], ['my','Burmese · မြန်မာ'],
  ['vi','Vietnamese · Tiếng Việt'], ['tr','Turkish · Türkçe'], ['de','German · Deutsch'], ['fr','French · Français'], ['es','Spanish · Español'], ['pt','Portuguese · Português'],
  ['pl','Polish · Polski'], ['cs','Czech · Čeština'], ['ru','Russian · Русский'], ['uk','Ukrainian · Українська'], ['el','Greek · Ελληνικά'], ['hy','Armenian · Հայերեն'],
  ['ka','Georgian · ქართული'], ['am','Amharic · አማርኛ'], ['sw','Swahili · Kiswahili'], ['id','Indonesian · Bahasa Indonesia'], ['mn','Mongolian · Монгол'],
] as const;
