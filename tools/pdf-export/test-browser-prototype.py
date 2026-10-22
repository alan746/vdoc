"""Real PDF regression checks for the bounded browser prototype, not release gates.

Run verify-browser-prototype.mjs first to refresh the second-reader evidence.
"""
import hashlib
import json
import re
import unittest
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/fixtures/browser-pdf-20261011'
PDFS = ROOT / 'output/pdf/browser-pdf-20261011'


def report(name):
    return json.loads((FIXTURE / f'{name}-report.json').read_text())


def text(name):
    return '\n'.join(p.extract_text() for p in PdfReader(PDFS / f'{name}.pdf').pages)


def compact(value):
    return re.sub(r'\s', '', value)


class BrowserPdfEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pdfjs = {r['name']: r for r in json.loads((FIXTURE / 'pdfjs.json').read_text())}

    def test_word_level_rtl_is_rejected_by_independent_reader(self):
        for name in ('arabic', 'hebrew'):
            with self.subTest(name=name):
                self.assertEqual(compact(text(name)), compact(report(name)['sourceText']))
                self.assertFalse(self.pdfjs[name]['exactIgnoringWhitespace'])
                self.assertTrue(self.pdfjs[name]['missingWholeWords'])

    def test_one_text_object_per_cluster_is_not_reader_independent(self):
        name = 'arabic-cluster'
        self.assertTrue(self.pdfjs[name]['exactIgnoringWhitespace'])
        self.assertNotEqual(compact(text(name)), compact(report(name)['sourceText']))

    def test_grouped_rtl_source_words_survive_both_readers(self):
        for script in ('arabic', 'hebrew'):
            name = f'{script}-cluster-contiguous'
            with self.subTest(name=name):
                self.assertEqual(compact(text(name)), compact(report(name)['sourceText']))
                self.assertTrue(self.pdfjs[name]['exactIgnoringWhitespace'])
                self.assertFalse(self.pdfjs[name]['missingWholeWords'])

    def test_whitespace_stripping_must_not_approve_hindi(self):
        name = 'words-cluster-contiguous'
        self.assertEqual(compact(text(name)), compact(report(name)['sourceText']))
        self.assertTrue(self.pdfjs[name]['exactIgnoringWhitespace'])
        self.assertIn('हिंदी', self.pdfjs[name]['missingWholeWords'])
        self.assertIn('प्रार्थना', self.pdfjs[name]['missingWholeWords'])

    def test_successful_blob_download_has_exact_browser_bytes(self):
        name = 'words-cluster-contiguous-safety'
        r = report(name)
        digest = hashlib.sha256((PDFS / f'{name}.pdf').read_bytes()).hexdigest()
        self.assertEqual(digest, r['sha256'])
        self.assertEqual(digest, r['download']['sha256'])
        self.assertEqual(r['download']['suggestedFilename'], f'{name}.pdf')
        self.assertTrue(r['sourceUnchanged'])

    def test_abort_and_unsupported_inputs_return_no_pdf(self):
        r = report('words-cluster-contiguous-safety')
        self.assertTrue(r['cancelled'])
        self.assertEqual({c['name'] for c in r['checks']}, {
            'cancel-after-start', 'missing-glyph', 'unsupported-bold',
            'page-overflow', 'token-limit', 'font-mismatch',
        })
        self.assertTrue(all(c['ok'] for c in r['checks']))

    def test_vector_pages_and_bounded_measured_widths(self):
        for script in ('words', 'arabic', 'hebrew'):
            name = f'{script}-cluster-contiguous'
            r = report(name)
            reader = PdfReader(PDFS / f'{name}.pdf')
            with self.subTest(name=name):
                self.assertEqual(len(reader.pages), 1)
                self.assertEqual(len(reader.pages[0].images), 0)
                self.assertLess(max(x['delta'] for x in r['report']['measurements']), .016)
                # All font resources are visible vector Type3; no invisible text mode.
                fonts = reader.pages[0]['/Resources']['/Font']
                self.assertTrue(all(f.get_object()['/Subtype'] == '/Type3' for f in fonts.values()))
                operations = reader.pages[0].get_contents().operations
                self.assertFalse(any(op == b'Tr' and int(args[0]) == 3 for args, op in operations))


if __name__ == '__main__':
    unittest.main(verbosity=2)
