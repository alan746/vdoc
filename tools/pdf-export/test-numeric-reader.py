"""Owned PDF artifact regressions; test success includes detecting unsupported cases.
These do not sign off the production exporter or all scripts/readers.
"""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib,json,re,unittest
from pathlib import Path
from PIL import Image,ImageChops
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2]
FIX=qa_path('reader-control-20261011')
OUT=ROOT/'output/pdf/browser-unicode-20261011'
GEN=qa_path('browser-unicode-20261011')
FINAL='record-number-tail'
def read(name):return json.loads((FIX/name).read_text())
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def rows(name):return read(name)['results']
def points(mode,inset=False,numbers=False):return rows(f"partial-{mode}-wide-standards{'-inset1' if inset else ''}{'-numbers' if numbers else ''}.json")
def collapse(s):return re.sub(r'\s+',' ',s).strip()
def new_pdfs():
 return sorted(set([*OUT.glob('*-record-digits*.pdf'),*OUT.glob('*-record-flow*.pdf'),*OUT.glob('*-record-alef-numbers.pdf'),*OUT.glob('*-record-number-tail*.pdf')]))
class NumericReader(unittest.TestCase):
 def test_21_pdfs_bound_to_sources_and_one_page(self):
  files=new_pdfs();self.assertEqual(len(files),21)
  for p in files:
   report=json.loads((GEN/(p.stem+'-report.json')).read_text());self.assertEqual(digest(p),report['sha256']);self.assertTrue(report['sourceUnchanged']);self.assertTrue(report['cancelled'])
   pdf=PdfReader(p);self.assertEqual(len(pdf.pages),1);self.assertFalse(pdf.pages[0].images)
 def test_final_seven_full_selections_and_56_words(self):
  result=rows(f'reader-{FINAL}.json')+rows(f'reader-{FINAL}-numbers.json');self.assertEqual(len(result),7)
  for r in result:
   self.assertEqual(digest(recorded_path(r['file'])),r['sha256']);self.assertEqual(collapse(r['source']),collapse(r['selectedText']));self.assertEqual(len(r['selections']),8)
   for s in r['selections']:self.assertIn(s['selectedText'].strip(),{s['expected'],re.sub(r'[।.]$','',s['expected'])})
 def test_no_regression_in_each_protocol_and_fixture(self):
  for inset,numbers,expected_fixed in [(False,False,1),(True,False,0),(False,True,11),(True,True,9)]:
   old,new=points('record-alef',inset,numbers),points(FINAL,inset,numbers);self.assertEqual(len(old),len(new));fixed=0
   for a,b in zip(old,new):
    self.assertEqual(a['label'],b['label']);self.assertEqual(len(a['selections']),len(b['selections']))
    for x,y in zip(a['selections'],b['selections']):
     self.assertEqual(tuple(x[k] for k in ('line','word','start','expected')),tuple(y[k] for k in ('line','word','start','expected')))
     if x['match']:self.assertTrue(y['match'],(inset,numbers,b['label'],x,y))
     fixed+=not x['match'] and y['match']
   self.assertEqual(fixed,expected_fixed)
 def test_exact_totals_keep_edge_and_interior_failures_separate(self):
  for inset,numbers,expected in [(False,False,[50,78,61,51,33]),(True,False,[50,82,61,36,33]),(False,True,[72,65]),(True,True,[75,65])]:
   self.assertEqual([sum(s['match'] for s in r['selections']) for r in points(FINAL,inset,numbers)],expected)
 def test_arabic_indic_digits_selected_at_both_offsets(self):
  for inset in (False,True):
   row=points(FINAL,inset,True)[0];selected=[s for s in row['selections'] if s['word']=='١٢٣٤٥٦٧٨٩٠'];self.assertEqual(len(selected),10);self.assertTrue(all(s['match'] for s in selected))
 def test_independent_geometry_is_not_sufficient_for_ink_or_drag(self):
  result=rows('numeric-direction-geometry.json');self.assertEqual([sum(c['centerWithinSourceRange'] for c in r['characters']) for r in result],[0,10,10])
  for r in result:self.assertEqual(digest(recorded_path(r['file'])),r['sha256'])
  bad=[s for s in points('record-digits',True,True)[0]['selections'] if s['word']=='١٢٣٤٥٦٧٨٩٠'];self.assertEqual(len(bad),10);self.assertTrue(all(not s['match'] for s in bad))
 def test_broad_digit_boxes_are_rejected_for_new_failure(self):
  a,b=points('record-alef',False,True)[1],points('record-digits',False,True)[1]
  regressions=[(x,y) for x,y in zip(a['selections'],b['selections']) if x['match'] and not y['match']]
  self.assertEqual(len(regressions),1);self.assertEqual(regressions[0][0]['expected'],'9')
 def test_visual_token_order_rejected_despite_pdfjs_success(self):
  chrome={r['label']:r for r in rows('reader-record-flow.json')}
  js=[r for r in rows('pdfjs-browser-digits-flow.json') if r['mode']=='record-flow'];self.assertEqual(len(js),2)
  for r in js:self.assertTrue(r['matchCollapsed']);self.assertFalse(chrome[r['label']]['matchCollapsed'])
 def test_real_pdfjs_layers_keep_all_six_rtl_failures(self):
  result=rows('pdfjs-browser-number-tail.json');self.assertEqual(len(result),7)
  self.assertEqual([r['matchCollapsed'] for r in result],[True,False,False,False,False,False,False])
  for r in result:
   self.assertEqual(r['version'],'5.6.205');self.assertEqual(r['errors'],[]);self.assertTrue(r['spans']);self.assertEqual(digest(recorded_path(r['file'])),r['pdfSha256']);self.assertTrue((recorded_path(r['screenshot'])).is_file())
 def test_source_geometry_and_pixels_match_originals(self):
  for mode,numbers in [('record-digits',False),(FINAL,False),('record-alef',True),('record-digits',True),(FINAL,True)]:
   for inset in (False,True):
    for r in points(mode,inset,numbers):
     g=r['sourceGeometry'];self.assertEqual(g['compatMode'],'CSS1Compat');self.assertLessEqual(g['maxRectDelta'],.05);self.assertLessEqual(g['maxTokenWidthDelta'],.05)
     source=FIX/f"source-{mode}-wide-standards{'-inset1' if inset else ''}{'-numbers' if numbers else ''}-{r['label']}.png";original=GEN/(Path(r['file']).stem+'-browser.png')
     self.assertIsNone(ImageChops.difference(Image.open(source).convert('RGB'),Image.open(original).convert('RGB')).getbbox())
 def test_final_base_visible_paths_and_positions_preserved(self):
  for r in rows('record-number-tail-ink-geometry.json'):
   self.assertEqual(digest(recorded_path(r['baseline'])),r['baselineSha256']);self.assertEqual(digest(recorded_path(r['candidate'])),r['candidateSha256']);self.assertTrue(r['exactPathMultiset']);self.assertLessEqual(r['maxTransformDelta'],.0001)
 def test_render_pixel_differences_remain_explicit(self):
  result=read('number-tail-renders.json');self.assertEqual(len(result),7);self.assertEqual(sum(r['pixelIdentical'] for r in result),3)
  for r in result:
   bbox=ImageChops.difference(Image.open(recorded_path(r['render'])).convert('RGB'),Image.open(recorded_path(r['baseline'])).convert('RGB')).getbbox();self.assertEqual(list(bbox) if bbox else None,r['differenceBounds']);self.assertEqual(bbox is None,r['pixelIdentical'])
 def test_positive_and_absent_search_controls(self):
  for mode in ('record-digits',FINAL):
   result=rows(f'search-{mode}-highlight-audit.json');self.assertEqual(len(result),5)
   for r in result:
    self.assertTrue(r['highlightContainedInTarget']);self.assertTrue(r['negativeClearsHighlight'])
    for s in r['screenshots']:self.assertEqual(digest(recorded_path(s['file'])),s['sha256'])
 def test_numeric_hitboxes_are_terminal_only(self):
  reports=[json.loads((GEN/(p.stem+'-report.json')).read_text()) for p in new_pdfs() if FINAL in p.stem]
  self.assertEqual(len(reports),7)
  for report in reports:
   for hit in report['report']['hitMeasurements']:
    if hit['word'].isdecimal():self.assertEqual(hit['sourceStart']+len(hit['text']),len(hit['word']))
    else:self.assertIn(hit['text'],['ا','ل'])
if __name__=='__main__':unittest.main(verbosity=2)
