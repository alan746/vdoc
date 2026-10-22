"""Regression against actual saved PDFs, including visually intact lost text.

Run with the bundled Python runtime (pypdf/pdfplumber). These are fixture-B
checks, not a certification of arbitrary multilingual documents.
"""
import importlib.util
import logging
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('verify', Path(__file__).with_name('verify-acceptance.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ActualPdfRegression(unittest.TestCase):
    def check_pdf(self, name):
        return module.verify(ROOT / 'output/pdf' / name, require_logical_hindi=True)

    def test_embedded_direct_and_native_scales(self):
        for name in ['pdf-font-20261011/embedded-logical-b.pdf'] + [
            f'safari-native-20261011/embedded-native-{scale}.pdf' for scale in [100, 101, 93]
        ]:
            with self.subTest(pdf=name):
                result = self.check_pdf(name)
                self.assertTrue(result['passed'], result['failures'])

    def test_five_visible_pages_with_missing_cjk_are_rejected(self):
        result = self.check_pdf('safari-native-20261011/sangam-native-100.pdf')
        self.assertFalse(result['passed'])
        self.assertEqual(result['failures'], [f'Page {i}: cjkCodepointsPreserved' for i in range(1, 6)])

    def test_five_pages_without_hindi_or_cjk_are_rejected(self):
        result = self.check_pdf('safari-native-20261011/global-native-100.pdf')
        self.assertFalse(result['passed'])
        self.assertIn('Page 1: cjkCodepointsPreserved', result['failures'])
        self.assertIn('Page 1: hindiCodepointsPreserved', result['failures'])

    def test_inventory_alone_does_not_prove_hindi_order(self):
        result = self.check_pdf('pdf-unicode-20261011/repaired-b.pdf')
        self.assertTrue(result['pages'][0]['checks']['hindiCodepointsPreserved'])
        self.assertIn('Page 1: logicalHindiOrder', result['failures'])

    def test_original_native_baseline_is_not_a_multilingual_pass(self):
        result = self.check_pdf('safari-native-20261011/b-100.pdf')
        self.assertIn('Page 1: arabicCodepointsPreserved', result['failures'])
        self.assertIn('Page 1: logicalHindiOrder', result['failures'])

    def test_original_scale_regression_still_rejected(self):
        result = self.check_pdf('safari-native-20261011/b-101.pdf')
        self.assertFalse(result['passed'])
        self.assertIn('Expected 5 pages; found 12', result['failures'])


if __name__ == '__main__':
    logging.getLogger('pypdf').setLevel(logging.ERROR)
    logging.getLogger('pdfminer').setLevel(logging.ERROR)
    unittest.main(verbosity=2)
