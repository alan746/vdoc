"""Retained PDF/real-reader regressions. This does not sign off product export."""
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
ROOT=Path(__file__).resolve().parents[2]
FIX=qa_path('reader-control-20261011')
VARIANTS=('whole-cluster','cluster-actual','local-clusters','record-actual')
def read(name):return json.loads((FIX/name).read_text())
def collapsed(text):return re.sub(r'\s+',' ',text).strip()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rows(name):return {r['label']:r for r in read(name)['results']}

class ClusterAnnotations(unittest.TestCase):
    def test_20_pdfs_and_reader_results_bind_exact_sources(self):
        for encoding in VARIANTS:
            result=rows(f'reader-{encoding}.json');self.assertEqual(len(result),5)
            for row in result.values():
                self.assertNotIn('error',row)
                path=recorded_path(row['file']);report=json.loads((qa_path('browser-unicode-20261011')/(path.stem+'-report.json')).read_text())
                self.assertEqual(digest(path),row['sha256']);self.assertEqual(row['sha256'],report['sha256'])
                self.assertEqual(row['source'],report['sourceText']);self.assertTrue(report['sourceUnchanged']);self.assertTrue(report['cancelled'])
    def test_record_annotations_preserve_five_full_copies_and_40_words(self):
        for row in rows('reader-record-actual.json').values():
            self.assertEqual(collapsed(row['source']),collapsed(row['selectedText']))
            self.assertEqual(len(row['selections']),8)
            for point in row['selections']:
                self.assertIn(point['selectedText'].strip(),{point['expected'],re.sub(r'[।.]$','',point['expected'])})
    def test_hindi_regression_improves_without_hiding_failed_rtl(self):
        old=rows('partial-bidi-runs-stable.json');new=rows('partial-record-actual-stable.json')
        self.assertEqual(sum(p['match'] for p in old['words']['selections']),7)
        self.assertEqual(sum(p['match'] for p in new['words']['selections']),9)
        self.assertEqual(sum(not p['match'] for r in new.values() for p in r['selections']),5)
    def test_all_50_wide_hindi_ranges_including_table_cells(self):
        row=rows('partial-record-actual-wide-standards.json')['words']
        self.assertEqual(len(row['selections']),50)
        self.assertTrue(any(p['line']>=4 for p in row['selections']))
        self.assertTrue(all(p['selectedText']==p['expected'] for p in row['selections']))
    def test_wide_geometry_matches_original_source_pixels(self):
        for row in rows('partial-record-actual-wide-standards.json').values():
            geometry=row['sourceGeometry'];self.assertEqual(geometry['compatMode'],'CSS1Compat')
            self.assertLessEqual(geometry['maxRectDelta'],0.05);self.assertLessEqual(geometry['maxTokenWidthDelta'],0.05)
            actual=FIX/f"source-record-actual-wide-standards-{row['label']}.png"
            expected=qa_path('browser-unicode-20261011')/(Path(row['file']).stem+'-browser.png')
            self.assertIsNone(ImageChops.difference(Image.open(actual).convert('RGB'),Image.open(expected).convert('RGB')).getbbox())
    def test_local_annotation_scope_never_replaces_a_line_or_word(self):
        found=[]
        for row in rows('reader-record-actual.json').values():
            pdf=PdfReader(recorded_path(row['file']));self.assertEqual(len(pdf.pages),1);self.assertFalse(pdf.pages[0].images)
            spans=[str(args[1]['/ActualText']) for args,op in ContentStream(pdf.pages[0].get_contents(),pdf).operations if op==b'BDC' and '/ActualText' in args[1]]
            if row['label']!='words':self.assertEqual(spans,[])
            for span in spans:
                self.assertNotRegex(span,r'\s');self.assertGreater(len(span),1);self.assertLessEqual(len(span),4)
            found+=spans
        self.assertIn('हि',found)
    def test_new_reader_copy_does_not_mask_pdfjs_word_boundary_regression(self):
        candidate=read('record-actual-pdfjs.json');intermediate=read('local-clusters-pdfjs.json')
        hindi=next(r for r in candidate if r['name'].startswith('words'))
        self.assertTrue(hindi['matchCollapsed']);self.assertEqual(hindi['missingWholeWords'],[])
        self.assertFalse(next(r for r in intermediate if r['name'].startswith('words'))['matchCollapsed'])
        self.assertTrue(all(not r['matchCollapsed'] for r in candidate if not r['name'].startswith('words')))
    def test_pixels_remain_unchanged_for_combined_candidates(self):
        for encoding,count in [('whole-cluster',4),('cluster-actual',4),('local-clusters',5),('record-actual',5)]:
            results=read(f'{encoding}-pixels-pypdf.json');self.assertEqual(sum(r['pixelIdentical'] for r in results),count)
            for row in results:
                actual=FIX/(Path(row['file']).stem+'-render.png');reference=recorded_path(row['reference'])
                diff=ImageChops.difference(Image.open(actual).convert('RGB'),Image.open(reference).convert('RGB')).getbbox()
                self.assertEqual(diff is None,row['pixelIdentical'])
    def test_whole_cluster_alone_and_all_scripts_actualtext_are_rejected(self):
        for encoding in ('whole-cluster','cluster-actual'):
            result=rows(f'reader-{encoding}.json')
            self.assertEqual(sum(r['matchCollapsed'] for r in result.values()),3)
            self.assertFalse(result['arabic-marked']['matchCollapsed']);self.assertFalse(result['hebrew-marked']['matchCollapsed'])
    def test_search_positive_and_absent_pixel_evidence(self):
        for row in read('search-record-actual-highlight-audit.json')['results']:
            self.assertTrue(row['highlightContainedInTarget']);self.assertTrue(row['negativeClearsHighlight'])
            for screenshot in row['screenshots']:self.assertEqual(digest(recorded_path(screenshot['file'])),screenshot['sha256'])
    def test_bbox_diagnostic_explains_distinct_failure_representations(self):
        result=rows('cluster-geometry-final.json')
        first=lambda label:result[label]['firstCharacters'][:2]
        a,b=first('bidi-runs');self.assertAlmostEqual(b['box'][0],b['box'][2])
        a,b=first('whole-cluster');self.assertEqual(a['box'],b['box'])
        a,b=first('record-actual');self.assertAlmostEqual(a['box'][2],b['box'][0]);self.assertGreater(b['box'][2],b['box'][0])
    def test_native_control_is_not_automatic_approval(self):
        result=rows('partial-native-control-stable.json')
        self.assertTrue(any(not p['match'] for r in result.values() for p in r['selections']))
        self.assertEqual(result['words']['selections'][-1]['selectedText'],'न्दी ')

if __name__=='__main__':unittest.main(verbosity=2)
