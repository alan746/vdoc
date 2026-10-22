"""Real-artifact checks for the Unicode-record diagnostic, not product sign-off."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'tests/fixtures/browser-unicode-20261011'
OUT = ROOT / 'output/pdf/browser-unicode-20261011'


def collapsed(text):
    # Preserve every word boundary; unlike deleting all whitespace.
    return re.sub(r'\s+', ' ', text).strip()


def source(name):
    return json.loads((FIX / f'{name}-report.json').read_text())['sourceText']


def extracted(name):
    return '\n'.join(p.extract_text() for p in PdfReader(OUT / f'{name}.pdf').pages)


class UnicodeEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = {x['name']: x for x in json.loads((FIX / 'pdfjs.json').read_text())}

    def test_hindi_words_and_main_paragraphs_preserve_spaces(self):
        name = 'words-unicode-ordered'
        self.assertEqual(collapsed(self.js[name]['text']), collapsed(source(name)))
        self.assertEqual(extracted(name).splitlines()[:4], source(name).splitlines()[:4])
        self.assertFalse(self.js[name]['missingWholeWords'])

    def test_basic_rtl_main_paragraphs_agree_in_both_readers(self):
        for script in ('arabic', 'hebrew'):
            name = f'{script}-unicode-ordered'
            with self.subTest(name=name):
                self.assertEqual(collapsed(self.js[name]['text']), collapsed(source(name)))
                self.assertEqual(extracted(name).splitlines()[:4], source(name).splitlines()[:4])

    def test_per_block_repositioning_does_not_pass_wrong_word_order(self):
        name = 'arabic-unicode-block'
        self.assertEqual(collapsed(self.js[name]['text']), collapsed(source(name)))
        self.assertNotEqual(extracted(name).splitlines()[1], source(name).splitlines()[1])

    def test_arabic_diacritic_positions_still_fail_pdfjs(self):
        name = 'arabic-unicode-ordered-marked'
        self.assertNotEqual(collapsed(self.js[name]['text']), collapsed(source(name)))
        # Improved pypdf diacritics on the plain RTL line do not approve the document.
        self.assertEqual(extracted(name).splitlines()[1], source(name).splitlines()[1])

    def test_mixed_rtl_digits_must_not_be_lost(self):
        for script in ('arabic', 'hebrew'):
            name = f'{script}-unicode-ordered-marked'
            with self.subTest(name=name):
                self.assertIn('123', source(name))
                self.assertIn('123', self.js[name]['text'])
                self.assertNotIn('123', extracted(name))  # Retain observed failure.

    def test_adjacent_table_cells_are_not_a_full_flat_text_pass(self):
        name = 'words-unicode-ordered'
        self.assertNotEqual(collapsed(extracted(name)), collapsed(source(name)))
        self.assertIn('Different contextशिक्षा', extracted(name))

    def test_download_cancel_and_wrap_refusal(self):
        name = 'words-unicode-ordered-safety'
        r = json.loads((FIX / f'{name}-report.json').read_text())
        sha = hashlib.sha256((OUT / f'{name}.pdf').read_bytes()).hexdigest()
        self.assertEqual(sha, r['sha256'])
        self.assertEqual(sha, r['download']['sha256'])
        self.assertTrue(r['sourceUnchanged'])
        self.assertTrue(r['cancelled'])
        self.assertEqual({x['name'] for x in r['checks']}, {
            'cancel-after-start', 'missing-glyph', 'unsupported-bold', 'page-overflow',
            'token-limit', 'font-mismatch', 'wrapped-block',
        })
        self.assertTrue(all(x['ok'] for x in r['checks']))

    def test_hindi_visible_pixels_unchanged(self):
        from PIL import Image, ImageChops
        before = ROOT / 'tests/fixtures/browser-pdf-20261011/words-cluster-contiguous-render.png'
        after = FIX / 'words-unicode-ordered-render.png'
        self.assertIsNone(ImageChops.difference(Image.open(before), Image.open(after)).getbbox())
        reader = PdfReader(OUT / 'words-unicode-ordered.pdf')
        self.assertEqual(len(reader.pages), 1)
        self.assertFalse(reader.pages[0].images)


if __name__ == '__main__':
    unittest.main(verbosity=2)
