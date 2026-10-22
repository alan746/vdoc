"""Real QA artifact regressions. Passing tests include detecting retained failures."""
import hashlib
import importlib.util
import json
import re
import unittest
from pathlib import Path
from PIL import Image, ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'tests/fixtures/reader-control-20261011'
def read(name):return json.loads((FIX/name).read_text())
def collapsed(text):return re.sub(r'\s+',' ',text).strip()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

class BidiRunsEvidence(unittest.TestCase):
    def test_full_copy_and_word_evidence_bind_exact_sources(self):
        for variant in ('bidi-runs','cluster-width'):
            rows=read(f'reader-{variant}.json')['results']
            self.assertEqual(len(rows),5)
            for row in rows:
                self.assertNotIn('error',row)
                pdf=ROOT/row['file']; report=json.loads((ROOT/'tests/fixtures/browser-unicode-20261011'/(pdf.stem+'-report.json')).read_text())
                self.assertEqual(digest(pdf),row['sha256'])
                self.assertEqual(row['sha256'],report['sha256'])
                self.assertEqual(row['source'],report['sourceText'])
                self.assertTrue(report['sourceUnchanged']);self.assertTrue(report['cancelled'])
                self.assertEqual(len(row['selections']),8)
    def test_five_full_copies_preserve_word_boundaries(self):
        for row in read('reader-bidi-runs.json')['results']:
            self.assertEqual(collapsed(row['source']),collapsed(row['selectedText']))
    def test_40_visible_word_selections_preserve_marks(self):
        for row in read('reader-bidi-runs.json')['results']:
            for point in row['selections']:
                self.assertIn(point['selectedText'].strip(),{point['expected'],re.sub(r'[।.]$','',point['expected'])})
    def test_marked_samples_improve_without_reversing_digits(self):
        old={r['label']:r for r in read('reader-sourcewords.json')['results']}
        for row in read('reader-bidi-runs.json')['results']:
            if row['label'].endswith('-marked'):
                self.assertFalse(old[row['label']]['matchCollapsed']);self.assertTrue(row['matchCollapsed'])
                self.assertEqual(re.findall(r'\d+',row['selectedText']),['123'])
    def test_no_actualtext_or_page_raster_substitution(self):
        for variant in ('bidi-runs','cluster-width'):
            for row in read(f'reader-{variant}.json')['results']:
                pdf=PdfReader(ROOT/row['file']);self.assertEqual(len(pdf.pages),1);self.assertFalse(pdf.pages[0].images)
                for args,op in ContentStream(pdf.pages[0].get_contents(),pdf).operations:
                    self.assertFalse(op==b'BDC' and '/ActualText' in args[1])
    def test_render_differences_retained(self):
        for variant,identical in [('bidi-runs',4),('cluster-width',5)]:
            rows=read(f'{variant}-pixels-pypdf.json');self.assertEqual(sum(r['pixelIdentical'] for r in rows),identical)
            for row in rows:
                actual=FIX/(Path(row['file']).stem+'-render.png')
                bbox=ImageChops.difference(Image.open(actual).convert('RGB'),Image.open(ROOT/row['reference']).convert('RGB')).getbbox()
                self.assertEqual(bbox is None,row['pixelIdentical']);self.assertEqual(list(bbox) if bbox else None,row['bounds'])
    def test_search_highlights_and_negative_controls(self):
        spec=importlib.util.spec_from_file_location('search_audit',ROOT/'tools/pdf-export/audit-search-bidi-runs.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        actual=json.loads(json.dumps(mod.audit()));saved=read('search-bidi-runs-highlight-audit.json');self.assertEqual(actual,saved)
        self.assertEqual(len(saved['results']),5)
        for row in saved['results']:
            self.assertTrue(row['highlightContainedInTarget']);self.assertTrue(row['negativeClearsHighlight'])
            self.assertGreater(row['highlightPixelCounts']['match'],0)
    def test_partial_selection_source_and_geometry_are_verified(self):
        for variant in ('bidi-runs','cluster-width'):
            rows=read(f'partial-{variant}.json')['results'];self.assertEqual(len(rows),5)
            self.assertEqual(sum(len(r['selections']) for r in rows),55)
            for row in rows:
                self.assertNotIn('error',row);self.assertEqual(digest(ROOT/row['file']),row['sha256'])
                self.assertLessEqual(row['sourceGeometry']['maxRectDelta'],0.05)
                for point in row['selections']:self.assertEqual(point['expected'],point['word'][point['start']:point['end']])
    def test_partial_selection_failure_not_hidden_by_whole_word_pass(self):
        rows=read('partial-bidi-runs.json')['results']
        latin=[p for r in rows for p in r['selections'] if p['line']==0]
        self.assertEqual(len(latin),35);self.assertTrue(all(p['match'] for p in latin))
        failures=[p for r in rows for p in r['selections'] if not p['match']]
        self.assertEqual(len(failures),7)
        self.assertTrue(any(p['expected']=='हि' and p['selectedText']=='ह' for p in failures))
    def test_width_distribution_is_rejected_control(self):
        rows=read('reader-cluster-width.json')['results']
        self.assertEqual(sum(r['matchCollapsed'] for r in rows),3)
        for row in rows:
            if row['label'].endswith('-marked'):self.assertFalse(row['matchCollapsed'])
        partial=read('partial-cluster-width.json')['results']
        self.assertGreater(sum(not p['match'] for r in partial for p in r['selections']),7)
    def test_pdfjs_whitespace_removal_is_not_strict_text_acceptance(self):
        rows=read('bidi-runs-pdfjs.json')
        self.assertEqual(sum(collapsed(r['text'])==collapsed(r['source']) for r in rows),1)
        for row in rows:
            if row['name'].endswith('-marked'):
                self.assertFalse(row['exactIgnoringWhitespace']);self.assertTrue(row['missingWholeWords'])
    def test_pypdf_still_disagrees_for_rtl(self):
        sources={Path(r['file']).stem:r['source'] for r in read('reader-bidi-runs.json')['results']}
        for row in read('bidi-runs-pixels-pypdf.json'):
            if not Path(row['file']).name.startswith('words'):
                self.assertNotEqual(collapsed(row['pypdfText']),collapsed(sources[Path(row['file']).stem]))

if __name__=='__main__':unittest.main(verbosity=2)
