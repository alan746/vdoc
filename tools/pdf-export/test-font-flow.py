"""Read actual long-document PDF evidence; no mocked text renderer."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path
from pathlib import Path
import importlib.util
import json
import tempfile
import unicodedata
import unittest
from pypdf import PdfReader
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = qa_path('pdf-prefont-20261011')
OUTPUT = ROOT / 'output/pdf/pdf-prefont-20261011'
spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair-unicode.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def node_text(node):
    return node.get('text', '') + ''.join(node_text(c) for c in node.get('content', []))


def hindi(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if '\u0900' <= c <= '\u097f')


class LongDocumentEvidence(unittest.TestCase):
    def test_early_font_trace_and_copy_geometry(self):
        report = json.loads((OUTPUT / 'flow-fallback.pdf.json').read_text())
        state = report['earlyFontState']
        self.assertLessEqual(state['loaded'], state['atRender']['at'])
        self.assertLessEqual(state['atRender']['at'], state['firstPage']['at'])
        self.assertEqual(state['firstPage']['fonts'], 'loaded')
        self.assertTrue(all(f['present'] and f['status'] == 'loaded' for f in state['atRender']['faces']))
        self.assertFalse(report['layoutDifferences'])
        self.assertTrue(report['sourceUnchanged'])
        self.assertFalse(report['blockedExternalOrigins'])

    def test_global_mapping_repair_refuses_context_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'must-not-exist.pdf'
            with self.assertRaisesRegex(ValueError, 'unaccounted use'):
                repair.repair(OUTPUT / 'flow.pdf', output, logical_order=True)
            self.assertFalse(output.exists())

    def test_contextual_direct_pdf_preserves_full_hindi_sequence(self):
        fixture = json.loads((EVIDENCE / 'flow.vdoc.json').read_text())
        reader = PdfReader(OUTPUT / 'flow-fallback-contextual.pdf')
        actual = '\n'.join(p.extract_text() for p in reader.pages)
        self.assertEqual(len(reader.pages), 4)
        self.assertEqual(len(hindi(actual)), 3318)
        self.assertEqual(hindi(actual), hindi(node_text(fixture['content'])))
        self.assertNotIn('\x00', actual)
        for page in range(1, 5):
            original = Image.open(EVIDENCE / f'renders/flow-fallback-{page}.png').convert('RGB')
            fixed = Image.open(EVIDENCE / f'renders/flow-fallback-contextual-{page}.png').convert('RGB')
            self.assertEqual(original.size, fixed.size)
            self.assertIsNone(ImageChops.difference(original, fixed).getbbox())

    def test_native_page_count_does_not_hide_text_loss(self):
        fixture = json.loads((EVIDENCE / 'flow.vdoc.json').read_text())
        reader = PdfReader(ROOT / 'output/pdf/safari-native-20261011/flow-native-101.pdf')
        actual = '\n'.join(p.extract_text() for p in reader.pages)
        self.assertEqual(len(reader.pages), 4)
        for n in range(1, 9):
            self.assertEqual(actual.count(f'BLOCK {n:02}'), 1)
            self.assertEqual(actual.count(f'END {n:02}'), 1)
        self.assertNotEqual(hindi(actual), hindi(node_text(fixture['content'])))
        pdfjs = json.loads((EVIDENCE / 'pdfjs.json').read_text())
        self.assertTrue(pdfjs[0]['hindiOrder'])
        self.assertFalse(pdfjs[1]['hindiOrder'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
