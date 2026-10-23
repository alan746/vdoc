"""Real-reader failures reject the atomic-grapheme QA candidate despite preserved ink."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib
import json
import unittest
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
FIX = qa_path('reader-control-20261011')
GEN = qa_path('browser-unicode-20261011')


def read(name):
    return json.loads((FIX / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class GraphemeIndices(unittest.TestCase):
    def test_generated_bytes_and_unchanged_source(self):
        files = list((ROOT / 'output/pdf/browser-unicode-20261011').glob('*-record-grapheme*.pdf'))
        self.assertEqual(len(files), 7)
        for path in files:
            report = json.loads((GEN / (path.stem + '-report.json')).read_text())
            self.assertEqual(sha(path), report['sha256'])
            self.assertTrue(report['sourceUnchanged'])
            self.assertTrue(report['cancelled'])
            self.assertEqual(len(PdfReader(path).pages), 1)

    def test_actual_chrome_copy_rejects_marked_candidate(self):
        old = {r['label']: r for r in read('reader-record-marked-boxes.json')['results']}
        current = read('reader-record-grapheme.json')['results']
        self.assertEqual(len(current), 5)
        for row in current:
            self.assertNotIn('error', row)
            self.assertEqual(sha(recorded_path(row['file'])), row['sha256'])
            self.assertEqual(row['source'], old[row['label']]['source'])
            self.assertTrue(old[row['label']]['matchCollapsed'])
            self.assertEqual(row['matchCollapsed'], not row['label'].endswith('-marked'))
        self.assertEqual(sum(s['match'] for r in current for s in r['selections']), 31)
        self.assertEqual(sum(len(r['selections']) for r in current), 40)

    def test_visible_word_selection_detects_letter_swaps(self):
        rows = {r['label']: r for r in read('reader-record-grapheme.json')['results']}
        for label, expected, wrong in [('arabic-marked', 'جَمِيلَةٌ', 'جَمِليَةٌ'),
                                      ('hebrew-marked', 'שָׁלוֹם', 'שָׁולֹם')]:
            probes = [s for s in rows[label]['selections'] if s['expected'] == expected]
            self.assertTrue(probes)
            for probe in probes:
                self.assertEqual(probe['selectedText'], wrong)
                self.assertFalse(probe['match'])

    def test_pdfjs_dom_does_not_claim_cross_reader_acceptance(self):
        rows = read('pdfjs-browser-grapheme.json')['results']
        self.assertEqual(len(rows), 7)
        for row in rows:
            self.assertEqual(row['errors'], [])
            self.assertEqual(sha(recorded_path(row['file'])), row['pdfSha256'])
            self.assertEqual(row['matchCollapsed'], row['label'] == 'words')
            self.assertTrue((recorded_path(row['screenshot'])).is_file())

    def test_standalone_indices_never_guess_missing_word_offsets(self):
        data = read('grapheme-indices.json')
        self.assertEqual(data['engine'], '153.0.7999.0')
        self.assertEqual(len(data['results']), 6)
        for row in data['results']:
            self.assertEqual(sha(recorded_path(row['file'])), row['sha256'])
            self.assertTrue(row['BMPCountMatches'])
            self.assertTrue(all(ord(c) <= 0xffff for c in row['selectedText']))
            if row['mode'] == 'record-grapheme':
                self.assertFalse(row['sourceWordPresent'])
                self.assertEqual(row['characters'], [])
                self.assertEqual(row['hitIndices'], [])
            else:
                self.assertTrue(row['sourceWordPresent'])
                for char in row['characters']:
                    self.assertEqual(row['selectedText'][char['index']], char['unicode'])
                for hit in row['hitIndices']:
                    for index, char in zip(hit['rightThenLeftIndices'], hit['rightThenLeftChars']):
                        self.assertEqual(row['selectedText'][index] if index is not None else None, char)

    def test_loose_bounds_are_not_pointer_success_evidence(self):
        data = read('grapheme-indices.json')['results']
        row = next(r for r in data if r['mode'] == 'record-marked-boxes' and r['label'] == 'arabic-marked')
        fatha = row['characters'][-3]
        self.assertEqual(fatha['unicode'], 'َ')
        self.assertGreater(fatha['looseBox'][2] - fatha['looseBox'][0],
                           2 * (fatha['tightBox'][2] - fatha['tightBox'][0]))
        # A different encoding makes the boxes agree but loses a real selected mark.
        rows = read('partial-record-mark-advance-wide-standards-focused-controls.json')['results']
        probe = next(s for r in rows if r['label'] == 'arabic-marked' for s in r['selections']
                     if s['word'] == 'جَمِيلَةٌ' and s['expected'] == 'لَ')
        self.assertEqual(probe['selectedText'], 'ل')
        self.assertFalse(probe['match'])

    def test_preserved_ink_does_not_override_copy_failure(self):
        rows = read('record-grapheme-ink-geometry.json')['results']
        self.assertEqual(len(rows), 5)
        for row in rows:
            self.assertEqual(sha(recorded_path(row['candidate'])), row['candidateSha256'])
            self.assertEqual(sha(recorded_path(row['baseline'])), row['baselineSha256'])
            self.assertTrue(row['exactPathMultiset'])
            self.assertLessEqual(row['maxTransformDelta'], .0001)
        renders = read('grapheme-renders.json')
        self.assertEqual(len(renders), 7)
        self.assertEqual(sum(r['pixelIdentical'] for r in renders), 5)
        for row in renders:
            diff = ImageChops.difference(Image.open(recorded_path(row['render'])).convert('RGB'),
                                        Image.open(recorded_path(row['reference'])).convert('RGB')).getbbox()
            self.assertEqual(diff is None, row['pixelIdentical'])
            self.assertEqual(list(diff) if diff else None, row['differenceBounds'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
