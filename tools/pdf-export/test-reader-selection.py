"""Regress actual downloaded PDFs and recorded PDFium selection, not product sign-off."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib
import json
import re
import unittest
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[2]
FIX = qa_path('pdfkit-browser-20261011')


def read(name):
    return json.loads((FIX / name).read_text())


def collapsed(text):
    return re.sub(r'\s+', ' ', text).strip()


class ReaderSelectionEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = {r['label']: r for r in read('chrome-selection.json')['results']}
        cls.after = read('chrome-selection-actualtext.json')['results']

    def test_selection_evidence_is_bound_to_exact_pdf_bytes(self):
        for name in ('chrome-selection.json', 'chrome-selection-legacy.json', 'chrome-selection-actualtext.json'):
            for row in read(name)['results']:
                with self.subTest(name=name, label=row['label']):
                    self.assertNotIn('error', row)
                    self.assertEqual(hashlib.sha256((recorded_path(row['file'])).read_bytes()).hexdigest(), row['sha256'])
                    self.assertEqual(row['matchCollapsed'], collapsed(row['source']) == collapsed(row['selectedText']))

    def test_five_actual_reader_copies_preserve_words_marks_and_numbers(self):
        self.assertEqual(len(self.after), 5)
        for row in self.after:
            with self.subTest(label=row['label']):
                self.assertEqual(collapsed(row['selectedText']), collapsed(row['source']))
                self.assertEqual(row['sourceDigits'], row['selectedDigits'])

    def test_unannotated_rtl_and_library_are_real_negative_controls(self):
        for script in ('arabic', 'hebrew', 'arabic-marked', 'hebrew-marked'):
            self.assertFalse(self.before['unicode-' + script]['matchCollapsed'])
            self.assertFalse(self.before['pdfkit-' + script]['matchCollapsed'])
        self.assertFalse(self.before['pdfkit-words']['matchCollapsed'])
        for script in ('arabic', 'hebrew'):
            row = self.before['pdfkit-' + script + '-marked']
            self.assertEqual(row['sourceDigits'], ['123'])
            self.assertEqual(row['selectedDigits'], ['321'])

    def test_hindi_readers_disagree_so_extractor_failure_is_not_copy_failure(self):
        self.assertTrue(self.before['cluster-hindi']['matchCollapsed'])
        self.assertTrue(self.before['unicode-words']['matchCollapsed'])
        js = json.loads((qa_path('browser-pdf-20261011/pdfjs.json')).read_text())
        row = next(r for r in js if r['name'] == 'words-cluster-contiguous')
        self.assertTrue(row['missingWholeWords'])

    def test_actualtext_changes_neither_visible_pixels_nor_drawing_operators(self):
        for row in self.after:
            path = recorded_path(row['file'])
            old = path.with_name(path.name.replace('-actualtext', ''))
            new_pdf, old_pdf = PdfReader(path), PdfReader(old)
            self.assertEqual(len(new_pdf.pages), 1)
            operations = ContentStream(new_pdf.pages[0].get_contents(), new_pdf).operations
            drawn = [(args, op) for args, op in operations if op not in (b'BDC', b'EMC')]
            self.assertEqual(drawn, ContentStream(old_pdf.pages[0].get_contents(), old_pdf).operations)
            labels = [str(args[1]['/ActualText']) for args, op in operations if op == b'BDC']
            self.assertEqual(collapsed(' '.join(labels)), collapsed(row['source']))
            new_image = FIX / (path.stem + '-render.png')
            old_image = qa_path('browser-unicode-20261011') / (old.stem + '-render.png')
            self.assertIsNone(ImageChops.difference(Image.open(new_image).convert('RGB'), Image.open(old_image).convert('RGB')).getbbox())

    def test_other_extractors_remain_an_explicit_limitation(self):
        js = {r['name']: r for r in read('actualtext-pdfjs.json')}
        name = 'arabic-unicode-ordered-actualtext-marked'
        self.assertNotEqual(collapsed(js[name]['text']), collapsed(js[name]['source']))
        for script in ('arabic', 'hebrew'):
            path = ROOT / 'output/pdf/browser-unicode-20261011' / f'{script}-unicode-ordered-actualtext-marked.pdf'
            self.assertNotIn('123', PdfReader(path).pages[0].extract_text())

    def test_library_download_matches_bytes_and_source_was_unchanged(self):
        for path in sorted((ROOT / 'output/pdf/pdfkit-browser-20261011').glob('*.pdf')):
            report = read(path.stem + '-report.json')
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(sha, report['download']['sha256'])
            self.assertTrue(report['sourceUnchanged'])
            self.assertEqual(len(PdfReader(path).pages), 1)

    def test_full_copy_success_does_not_approve_wrong_word_hit_positions(self):
        rows = read('chrome-word-selection-offset.json')['results']
        self.assertEqual(len(rows), 6)
        for row in rows:
            with self.subTest(label=row['label']):
                self.assertNotIn('error', row)
                self.assertEqual(hashlib.sha256((recorded_path(row['file'])).read_bytes()).hexdigest(), row['sha256'])
                # The same on-screen point hits the intended word in the original;
                # whole-line ActualText changes selection despite identical pixels.
                expected = row['label'].endswith('-original')
                for selection in row['selections']:
                    self.assertEqual(selection['selectedText'].strip() == selection['expected'], expected)

    def test_smaller_annotations_and_combined_operators_do_not_close_rtl(self):
        for suffix in ('actualtext-word', 'single-tj', 'single-string'):
            rows = read(f'chrome-selection-{suffix}.json')['results']
            self.assertEqual(len(rows), 5)
            for row in rows:
                self.assertNotIn('error', row)
                self.assertEqual(hashlib.sha256((recorded_path(row['file'])).read_bytes()).hexdigest(), row['sha256'])
                self.assertEqual(collapsed(row['source']) == collapsed(row['selectedText']), row['label'].endswith('-words'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
