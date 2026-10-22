"""Retained real-reader/artifact regressions; not product acceptance sign-off."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'tests/fixtures/reader-control-20261011'


def read(name):
    return json.loads((FIX / name).read_text())


def collapsed(text):
    return re.sub(r'\s+', ' ', text).strip()


class ReaderMappingEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sourcewords = {r['label']: r for r in read('reader-sourcewords.json')['results']}

    def test_observations_bind_to_exact_pdf_and_source(self):
        for name in ('reader.json', 'reader-logical.json', 'reader-sourcewords.json'):
            rows = read(name)['results']
            self.assertEqual(len(rows), 5)
            for row in rows:
                self.assertNotIn('error', row)
                self.assertEqual(hashlib.sha256((ROOT / row['file']).read_bytes()).hexdigest(), row['sha256'])
                self.assertEqual(row['source'], read(row['label'] + '-report.json')['sourceText'])
                self.assertEqual(row['matchCollapsed'], collapsed(row['source']) == collapsed(row['selectedText']))

    def test_three_simple_samples_copy_and_24_word_targets(self):
        for name in ('words', 'arabic', 'hebrew'):
            row = self.sourcewords[name]
            self.assertEqual(collapsed(row['source']), collapsed(row['selectedText']))
            self.assertEqual(len(row['selections']), 8)
            for point in row['selections']:
                # Browser word selection may exclude terminal full stop/danda;
                # never remove combining marks or interior word boundaries.
                allowed = {point['expected'], re.sub(r'[।.]$', '', point['expected'])}
                self.assertIn(point['selectedText'].strip(), allowed)

    def test_same_simple_rtl_full_copy_failed_previous_visual_token_order(self):
        previous = json.loads((ROOT / 'tests/fixtures/pdfkit-browser-20261011/chrome-selection.json').read_text())
        rows = {r['label']: r for r in previous['results']}
        for script in ('arabic', 'hebrew'):
            self.assertFalse(rows['unicode-' + script]['matchCollapsed'])
            self.assertTrue(self.sourcewords[script]['matchCollapsed'])

    def test_no_whole_line_actualtext_replacement(self):
        for row in self.sourcewords.values():
            pdf = PdfReader(ROOT / row['file'])
            ops = ContentStream(pdf.pages[0].get_contents(), pdf).operations
            self.assertFalse(any(op == b'BDC' and '/ActualText' in args[1] for args, op in ops))
            self.assertEqual(len(pdf.pages), 1)
            self.assertFalse(pdf.pages[0].images)

    def test_native_print_is_a_control_not_automatic_text_approval(self):
        rows = read('reader.json')['results']
        self.assertTrue(all(not r['matchCollapsed'] for r in rows))
        hebrew = next(r for r in rows if r['label'] == 'hebrew')
        self.assertTrue(all(p['match'] for p in hebrew['selections']))

    def test_logical_codepoints_alone_do_not_preserve_word_semantics(self):
        self.assertTrue(all(not r['matchCollapsed'] for r in read('reader-logical.json')['results']))

    def test_diacritics_still_fail_and_digits_survive_in_reader(self):
        for name in ('arabic-marked', 'hebrew-marked'):
            row = self.sourcewords[name]
            self.assertFalse(row['matchCollapsed'])
            self.assertTrue(any(not p['match'] for p in row['selections']))
            self.assertEqual(re.findall(r'\d+', row['selectedText']), ['123'])

    def test_pixels_and_extractor_disagreement_are_not_hidden(self):
        rows = read('sourcewords-pixels-pypdf.json')
        for row in rows:
            path = ROOT / row['file']
            actual = FIX / (path.stem + '-render.png')
            reference = ROOT / row['reference']
            same = ImageChops.difference(Image.open(actual).convert('RGB'), Image.open(reference).convert('RGB')).getbbox() is None
            self.assertEqual(same, row['pixelIdentical'])
            if path.name.startswith('words') or path.name.startswith('arabic'):
                self.assertTrue(same)
            if path.stem in ('arabic-unicode-ordered-sourcewords', 'hebrew-unicode-ordered-sourcewords'):
                script = path.name.split('-')[0]
                self.assertNotEqual(collapsed(row['pypdfText']), collapsed(self.sourcewords[script]['source']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
