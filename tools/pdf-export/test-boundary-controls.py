"""Rejected boundary experiments and explicit-focus controls, never exporter signoff."""
import hashlib,json,unittest
from pathlib import Path
from PIL import Image,ImageChops
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2];FIX=ROOT/'tests/fixtures/reader-control-20261011';GEN=ROOT/'tests/fixtures/browser-unicode-20261011'
def read(name):return json.loads((FIX/name).read_text())
def rows(name):return read(name)['results']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def controls(mode,inset=False):return rows(f"partial-{mode}-wide-standards{'-inset1' if inset else ''}-focused-controls.json")
def find(rs,label,word,expected):return next(p for r in rs if r['label']==label for p in r['selections'] if p['word']==word and p['expected']==expected)
class BoundaryControls(unittest.TestCase):
 def test_fourteen_pdf_bytes_sources_and_pages(self):
  files=[p for mode in ['record-mark-advance','record-space-bounds'] for p in (ROOT/'output/pdf/browser-unicode-20261011').glob('*'+mode+'*.pdf')];self.assertEqual(len(files),14)
  for p in files:
   r=json.loads((GEN/(p.stem+'-report.json')).read_text());self.assertEqual(sha(p),r['sha256']);self.assertTrue(r['sourceUnchanged']);self.assertTrue(r['cancelled']);self.assertEqual(len(PdfReader(p).pages),1)
 def test_both_experiments_preserve_tested_full_and_word_selections(self):
  names=['reader-record-mark-advance.json','reader-record-mark-advance-numbers.json','reader-record-space-bounds.json'];result=[r for name in names for r in rows(name)];self.assertEqual(len(result),12)
  for r in result:self.assertEqual(sha(ROOT/r['file']),r['sha256']);self.assertTrue(r['matchCollapsed']);self.assertEqual(len(r['selections']),8);self.assertTrue(all(s['match'] for s in r['selections']))
 def test_focused_first_character_controls_all_pass(self):
  count=0
  for mode in ['record-marked-boxes','record-mark-advance','record-space-bounds']:
   for inset in (False,True):
    name=f"partial-{mode}-wide-standards{'-inset1' if inset else ''}-focused-controls.json";d=read(name);self.assertTrue(d['explicitFocus']);self.assertEqual(d['evidenceTag'],'focused-controls')
    for r in d['results']:
     first=[s for s in r['selections'] if s['expected']=='B'];self.assertEqual(len(first),1);self.assertTrue(first[0]['match']);count+=1
  self.assertEqual(count,30)
  for inset in (False,True):
   d=read(f"partial-record-mark-advance-wide-standards{'-inset1' if inset else ''}-numbers-focused-controls.json");self.assertTrue(d['explicitFocus'])
   for r in d['results']:
    self.assertEqual(len(r['selections']),1);self.assertEqual(r['selections'][0]['expected'],'B');self.assertTrue(r['selections'][0]['match']);count+=1
  self.assertEqual(count,34)
 def test_arabic_regression_persists_after_focus_control(self):
  a=find(controls('record-marked-boxes'),'arabic-marked','جَمِيلَةٌ','لَ');b=find(controls('record-mark-advance'),'arabic-marked','جَمِيلَةٌ','لَ');self.assertTrue(a['match']);self.assertFalse(b['match']);self.assertEqual(b['selectedText'],'ل')
 def test_local_gains_cannot_hide_that_regression(self):
  for label,word,expected in [('arabic-marked','جَمِيلَةٌ','ةٌ'),('hebrew-marked','כְּתִיבָה','כְּ')]:
   a=find(controls('record-marked-boxes'),label,word,expected);b=find(controls('record-mark-advance'),label,word,expected);self.assertFalse(a['match']);self.assertTrue(b['match'])
 def test_initial_empty_B_evidence_retained(self):
  rs=rows('partial-record-mark-advance-wide-standards.json');self.assertTrue(any(s['expected']=='B' and s['selectedText']=='' for r in rs for s in r['selections']))
  self.assertTrue(all(s['match'] for r in controls('record-mark-advance') for s in r['selections'] if s['expected']=='B'))
 def test_full_whitespace_experiment_preserves_source_geometry(self):
  d=read('partial-record-space-bounds-wide-standards-focused.json');self.assertTrue(d['explicitFocus']);self.assertEqual(sum(len(r['selections']) for r in d['results']),318)
  for r in d['results']:
   self.assertEqual(sha(ROOT/r['file']),r['sha256']);g=r['sourceGeometry'];self.assertEqual(g['compatMode'],'CSS1Compat');self.assertLessEqual(g['maxRectDelta'],.05);self.assertLessEqual(g['maxTokenWidthDelta'],.05)
   p=FIX/f"source-record-space-bounds-wide-standards-focused-{r['label']}.png";q=GEN/(Path(r['file']).stem+'-browser.png');self.assertIsNone(ImageChops.difference(Image.open(p).convert('RGB'),Image.open(q).convert('RGB')).getbbox())
 def test_space_boxes_rejected_for_new_word_tail_failure(self):
  a=rows('partial-record-marked-boxes-wide-standards.json');b=rows('partial-record-space-bounds-wide-standards-focused.json')
  regressions=[(u,v) for x,y in zip(a,b) for u,v in zip(x['selections'],y['selections']) if u['match'] and not v['match']]
  self.assertGreaterEqual(len(regressions),2);self.assertTrue(any(u['expected']=='م' and v['selectedText']=='م ' for u,v in regressions))
 def test_pdfjs_limits_are_unchanged_in_real_DOM(self):
  base=rows('pdfjs-browser-marked-boxes.json')
  for name in ['pdfjs-browser-mark-advance.json','pdfjs-browser-space-bounds.json']:
   current=rows(name);self.assertEqual(len(current),7)
   for a,b in zip(base,current):self.assertEqual(a['selectedText'],b['selectedText']);self.assertEqual(a['matchCollapsed'],b['matchCollapsed']);self.assertEqual(b['errors'],[]);self.assertEqual(sha(ROOT/b['file']),b['pdfSha256'])
 def test_visible_paths_and_rasters(self):
  for r in rows('record-mark-advance-ink-geometry.json'):self.assertTrue(r['exactPathMultiset']);self.assertLessEqual(r['maxTransformDelta'],.0001);self.assertEqual(sha(ROOT/r['candidate']),r['candidateSha256'])
  for name,count in [('mark-advance-renders.json',6),('space-bounds-renders.json',7)]:
   rs=read(name);self.assertEqual(len(rs),7);self.assertEqual(sum(r['pixelIdentical'] for r in rs),count)
   for r in rs:
    diff=ImageChops.difference(Image.open(ROOT/r['render']).convert('RGB'),Image.open(ROOT/r['reference']).convert('RGB')).getbbox();self.assertEqual(diff is None,r['pixelIdentical']);self.assertEqual(list(diff) if diff else None,r['differenceBounds'])
 def test_search_success_does_not_override_boundary_failure(self):
  rs=rows('search-record-mark-advance-highlight-audit.json');self.assertEqual(len(rs),5)
  for r in rs:
   self.assertTrue(r['highlightContainedInTarget']);self.assertTrue(r['negativeClearsHighlight'])
   for s in r['screenshots']:self.assertEqual(sha(ROOT/s['file']),s['sha256'])
if __name__=='__main__':unittest.main(verbosity=2)
