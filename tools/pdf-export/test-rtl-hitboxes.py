"""Artifact regressions for RTL experiments. Passing tests do not certify the exporter."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib,json,re,unittest
from pathlib import Path
from PIL import Image,ImageChops
from pypdf import PdfReader
from pypdf.generic import ContentStream
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('reader-control-20261011')
MODES=('record-rtl','record-boxes','record-alef')
def read(name):return json.loads((FIX/name).read_text())
def rows(name):return {r['label']:r for r in read(name)['results']}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def collapse(s):return re.sub(r'\s+',' ',s).strip()
def partial(mode,inset=False):return rows(f"partial-{mode}-wide-standards{'-inset1' if inset else ''}.json")
class RtlHitboxes(unittest.TestCase):
 def test_15_reader_pdfs_bound_to_unchanged_sources(self):
  for mode in MODES:
   result=rows(f'reader-{mode}.json');self.assertEqual(len(result),5)
   for row in result.values():
    self.assertNotIn('error',row);p=recorded_path(row['file']);r=json.loads((qa_path('browser-unicode-20261011')/(p.stem+'-report.json')).read_text())
    self.assertEqual(digest(p),r['sha256']);self.assertEqual(r['sha256'],row['sha256']);self.assertEqual(r['sourceText'],row['source']);self.assertTrue(r['sourceUnchanged']);self.assertTrue(r['cancelled'])
 def test_targeted_five_full_copies_and_forty_words(self):
  for row in rows('reader-record-alef.json').values():
   self.assertEqual(collapse(row['source']),collapse(row['selectedText']));self.assertEqual(len(row['selections']),8)
   for point in row['selections']:self.assertIn(point['selectedText'].strip(),{point['expected'],re.sub(r'[।.]$','',point['expected'])})
 def test_no_new_failures_at_both_recorded_pointer_insets(self):
  for inset in (False,True):
   old,new=partial('record-actual',inset),partial('record-alef',inset);fixed=0
   for label in old:
    a,b=old[label]['selections'],new[label]['selections'];self.assertEqual(len(a),len(b))
    for x,y in zip(a,b):
     self.assertEqual((x['line'],x['word'],x['start'],x['expected']),(y['line'],y['word'],y['start'],y['expected']))
     if x['match']:self.assertTrue(y['match'],(inset,label,x,y))
     if not x['match'] and y['match']:fixed+=1
   self.assertGreater(fixed,0)
 def test_272_of_318_does_not_hide_46_remaining_failures(self):
  actual=partial('record-alef');self.assertEqual([sum(p['match'] for p in row['selections']) for row in actual.values()],[50,78,61,50,33]);self.assertEqual(sum(not p['match'] for r in actual.values() for p in r['selections']),46)
  self.assertTrue(any(p['word']=='123' and not p['match'] for p in actual['arabic-marked']['selections']))
 def test_hindi_and_plain_hebrew_remain_complete(self):
  for inset in (False,True):
   for label,count in (('words',50),('hebrew',61)):
    points=partial('record-alef',inset)[label]['selections'];self.assertEqual(len(points),count);self.assertTrue(all(p['match'] for p in points))
 def test_rejected_rtl_annotations_and_broad_boxes_stay_rejected(self):
  self.assertEqual(sum(r['matchCollapsed'] for r in rows('reader-record-rtl.json').values()),3)
  old,broad=partial('record-actual'),partial('record-boxes')
  self.assertTrue(any(x['match'] and not y['match'] for label in old for x,y in zip(old[label]['selections'],broad[label]['selections'])))
 def test_source_coordinates_and_screenshots_are_identical(self):
  for mode,inset in [('record-rtl',False),('record-boxes',False),('record-alef',False),('record-boxes',True),('record-actual',True),('record-alef',True)]:
   for row in partial(mode,inset).values():
    g=row['sourceGeometry'];self.assertEqual(g['compatMode'],'CSS1Compat');self.assertLessEqual(g['maxRectDelta'],.05);self.assertLessEqual(g['maxTokenWidthDelta'],.05)
    a=FIX/f"source-{mode}-wide-standards{'-inset1' if inset else ''}-{row['label']}.png";b=qa_path('browser-unicode-20261011')/(Path(row['file']).stem+'-browser.png')
    self.assertIsNone(ImageChops.difference(Image.open(a).convert('RGB'),Image.open(b).convert('RGB')).getbbox())
 def test_actual_vectors_preserve_paths_and_placement(self):
  for r in read('alef-ink-geometry.json')['results']:
   self.assertEqual(digest(recorded_path(r['baseline'])),r['baselineSha256']);self.assertEqual(digest(recorded_path(r['candidate'])),r['candidateSha256']);self.assertTrue(r['exactPathMultiset']);self.assertLessEqual(r['maxTransformDelta'],.0001)
 def test_pixel_differences_are_not_relabelled_as_identical(self):
  result=read('alef-render-comparison.json')
  for r in result:
   diff=ImageChops.difference(Image.open(recorded_path(r['render'])).convert('RGB'),Image.open(recorded_path(r['reference'])).convert('RGB')).getbbox();self.assertEqual(diff is None,r['equal']);self.assertEqual(list(diff) if diff else None,r['differenceBounds'])
  regular=[r for r in result if '-safety-' not in r['file']];self.assertEqual(len(regular),5);self.assertEqual(sum(r['equal'] for r in regular),3)
 def test_search_positive_and_missing_controls(self):
  for mode in ('record-boxes','record-alef'):
   result=read(f'search-{mode}-highlight-audit.json')['results'];self.assertEqual(len(result),5)
   for r in result:
    self.assertTrue(r['highlightContainedInTarget']);self.assertTrue(r['negativeClearsHighlight'])
    for shot in r['screenshots']:self.assertEqual(digest(recorded_path(shot['file'])),shot['sha256'])
 def test_cross_reader_limitations_are_retained(self):
  for mode in MODES:
   result=[r for r in read(f'{mode}-pdfjs.json') if '-safety-' not in r['name']];self.assertEqual(len(result),5)
   self.assertTrue(next(r for r in result if r['name'].startswith('words'))['matchCollapsed'])
   self.assertTrue(all(not r['matchCollapsed'] for r in result if not r['name'].startswith('words')))
 def test_cancel_guard_and_download_bytes(self):
  for stem in ('words-unicode-ordered-safety-record-actual','arabic-unicode-ordered-safety-record-alef'):
   r=json.loads((qa_path('browser-unicode-20261011')/(stem+'-report.json')).read_text());self.assertTrue(r['sourceUnchanged']);self.assertTrue(r['cancelled']);self.assertEqual(len(r['checks']),7);self.assertTrue(all(c['ok'] for c in r['checks']));self.assertEqual(r['sha256'],r['download']['sha256']);self.assertEqual(digest(ROOT/'output/pdf/browser-unicode-20261011'/(stem+'.pdf')),r['sha256'])
 def test_targeted_scope_has_no_raster_or_rtl_actualtext(self):
  for row in rows('reader-record-alef.json').values():
   p=recorded_path(row['file']);pdf=PdfReader(p);self.assertEqual(len(pdf.pages),1);self.assertFalse(pdf.pages[0].images)
   spans=[str(a[1]['/ActualText']) for a,op in ContentStream(pdf.pages[0].get_contents(),pdf).operations if op==b'BDC' and '/ActualText' in a[1]]
   if row['label']!='words':self.assertEqual(spans,[])
   report=json.loads((qa_path('browser-unicode-20261011')/(p.stem+'-report.json')).read_text())
   for hit in report['report']['hitMeasurements']:
    self.assertIn(hit['text'],['ا','ل']);self.assertFalse(any('\u064b'<=c<='\u065f' for c in hit['word']))
if __name__=='__main__':unittest.main(verbosity=2)
