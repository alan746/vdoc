"""Verify scoped marked-word experiments using actual reader artifacts, not product signoff."""
import hashlib,json,re,unittest
from pathlib import Path
from PIL import Image,ImageChops
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2];FIX=ROOT/'tests/fixtures/reader-control-20261011';GEN=ROOT/'tests/fixtures/browser-unicode-20261011';MODE='record-marked-boxes'
def load(name):return json.loads((FIX/name).read_text())
def rows(name):return load(name)['results']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def partial(mode,inset=False,numbers=False):return rows(f"partial-{mode}-wide-standards{'-inset1' if inset else ''}{'-numbers' if numbers else ''}.json")
class MarkedSelection(unittest.TestCase):
 def test_all_eight_sources_unchanged_and_pdf_hashes(self):
  files=list((ROOT/'output/pdf/browser-unicode-20261011').glob('*record-marked-boxes*.pdf'));self.assertEqual(len(files),8)
  for p in files:
   d=json.loads((GEN/(p.stem+'-report.json')).read_text());self.assertEqual(sha(p),d['sha256']);self.assertTrue(d['sourceUnchanged']);self.assertTrue(d['cancelled']);self.assertEqual(len(PdfReader(p).pages),1)
 def test_seven_full_selections_and_fifty_six_words(self):
  result=rows(f'reader-{MODE}.json')+rows(f'reader-{MODE}-numbers.json');self.assertEqual(len(result),7)
  for r in result:
   self.assertEqual(sha(ROOT/r['file']),r['sha256']);self.assertTrue(r['matchCollapsed']);self.assertEqual(len(r['selections']),8);self.assertTrue(all(s['match'] for s in r['selections']))
 def test_each_pass_retained_with_both_offsets(self):
  for inset in (False,True):
   for numbers in (False,True):
    a,b=partial('record-number-tail',inset,numbers),partial(MODE,inset,numbers);self.assertEqual(len(a),len(b))
    for x,y in zip(a,b):
     self.assertEqual(x['label'],y['label']);self.assertEqual(len(x['selections']),len(y['selections']))
     for u,v in zip(x['selections'],y['selections']):
      self.assertEqual(tuple(u[k] for k in ['line','word','start','expected']),tuple(v[k] for k in ['line','word','start','expected']))
      if u['match']:self.assertTrue(v['match'],(inset,numbers,x['label'],u,v))
 def test_only_marked_samples_improve_and_failures_stay_visible(self):
  a,b=partial('record-number-tail'),partial(MODE);improved=0
  for x,y in zip(a,b):
   old=sum(s['match'] for s in x['selections']);new=sum(s['match'] for s in y['selections'])
   if 'marked' in x['label']:self.assertGreater(new,old);improved+=new-old;self.assertTrue(any(not s['match'] for s in y['selections']))
   else:self.assertEqual(new,old)
  self.assertGreater(improved,0)
 def test_numeric_edge_and_internal_totals_preserved(self):
  for inset,expected in [(False,[72,65]),(True,[75,65])]:self.assertEqual([sum(s['match'] for s in r['selections']) for r in partial(MODE,inset,True)],expected)
 def test_every_source_coordinate_and_screenshot_bound(self):
  for inset in (False,True):
   for numbers in (False,True):
    for r in partial(MODE,inset,numbers):
     g=r['sourceGeometry'];self.assertEqual(g['compatMode'],'CSS1Compat');self.assertLessEqual(g['maxRectDelta'],.05);self.assertLessEqual(g['maxTokenWidthDelta'],.05)
     p=FIX/f"source-{MODE}-wide-standards{'-inset1' if inset else ''}{'-numbers' if numbers else ''}-{r['label']}.png";q=GEN/(Path(r['file']).stem+'-browser.png');self.assertIsNone(ImageChops.difference(Image.open(p).convert('RGB'),Image.open(q).convert('RGB')).getbbox())
 def test_actual_pdfjs_failures_not_claimed_fixed(self):
  result=rows('pdfjs-browser-marked-boxes.json');self.assertEqual(len(result),7);self.assertEqual([r['matchCollapsed'] for r in result],[True,False,False,False,False,False,False])
  for r in result:self.assertEqual(r['errors'],[]);self.assertEqual(sha(ROOT/r['file']),r['pdfSha256'])
 def test_visible_vectors_unchanged_and_raster_differences_retained(self):
  for r in rows('record-marked-boxes-ink-geometry.json'):
   self.assertTrue(r['exactPathMultiset']);self.assertLessEqual(r['maxTransformDelta'],.0001);self.assertEqual(sha(ROOT/r['candidate']),r['candidateSha256'])
  renders=load('marked-boxes-renders.json');self.assertEqual(len(renders),7);self.assertEqual(sum(r['pixelIdentical'] for r in renders),5)
  for r in renders:
   diff=ImageChops.difference(Image.open(ROOT/r['render']).convert('RGB'),Image.open(ROOT/r['reference']).convert('RGB')).getbbox();self.assertEqual(diff is None,r['pixelIdentical']);self.assertEqual(list(diff) if diff else None,r['differenceBounds'])
 def test_search_highlight_positive_and_absent_controls(self):
  result=rows(f'search-{MODE}-highlight-audit.json');self.assertEqual(len(result),5)
  for r in result:
   self.assertTrue(r['highlightContainedInTarget']);self.assertTrue(r['negativeClearsHighlight'])
   for s in r['screenshots']:self.assertEqual(sha(ROOT/s['file']),s['sha256'])
 def test_new_candidate_rejects_seven_invalid_or_cancelled_exports(self):
  stem='arabic-unicode-ordered-safety-record-marked-boxes-marked';r=json.loads((GEN/(stem+'-report.json')).read_text());self.assertEqual(len(r['checks']),7);self.assertTrue(all(s['ok'] for s in r['checks']));self.assertEqual(r['sha256'],r['download']['sha256']);self.assertEqual(r['sha256'],sha(ROOT/'output/pdf/browser-unicode-20261011'/(stem+'.pdf')))
if __name__=='__main__':unittest.main(verbosity=2)
