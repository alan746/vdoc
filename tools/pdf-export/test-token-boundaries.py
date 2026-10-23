"""Real-PDF negative controls: visual equality must not hide selection regressions."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib,json,unittest
from pathlib import Path
from PIL import Image,ImageChops
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2]
FIX=qa_path('pdf-token-boundary-20261011')
READ=qa_path('reader-control-20261011')
GEN=qa_path('browser-unicode-20261011')
def read(path):return json.loads(path.read_text())
def results(name):return read(READ/name)['results']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
class TokenBoundaryControls(unittest.TestCase):
 def test_all_fifteen_pdfs_bound_to_unchanged_source(self):
  total=0
  for mode,count in [('token-boundary',7),('space-map',7),('leading-space',1)]:
   files=list((ROOT/'output/pdf/browser-unicode-20261011').glob('*record-'+mode+'*.pdf'));self.assertEqual(len(files),count)
   for p in files:
    report=read(GEN/(p.stem+'-report.json'));baseline=read(GEN/(p.stem.replace('record-'+mode,'record-marked-boxes')+'-report.json'))
    self.assertEqual(sha(p),report['sha256']);self.assertTrue(report['sourceUnchanged']);self.assertTrue(report['cancelled']);self.assertEqual(len(PdfReader(p).pages),1)
    self.assertEqual(report['sourceText'],baseline['sourceText']);self.assertEqual(report['targets'],baseline['targets']);total+=1
  self.assertEqual(total,15)
 def test_all_fifteen_renders_equal_despite_text_failure(self):
  rows=read(FIX/'renders.json')+read(FIX/'space-map-renders.json')+read(FIX/'leading-space-renders.json');self.assertEqual(len(rows),15)
  for r in rows:
   self.assertTrue(r['pixelIdentical']);self.assertIsNone(ImageChops.difference(Image.open(recorded_path(r['render'])).convert('RGB'),Image.open(recorded_path(r['reference'])).convert('RGB')).getbbox())
 def test_token_objects_rejected_in_both_readers(self):
  chrome=results('reader-record-token-boundary.json');pdfjs=results('pdfjs-browser-token-boundary.json')
  self.assertEqual([r['matchCollapsed'] for r in chrome],[True,False,False,False,False]);self.assertEqual([r['matchCollapsed'] for r in pdfjs],[True,False,False,False,False,False,False])
  self.assertEqual(sum(s['match'] for r in chrome for s in r['selections']),40)
 def test_leading_whitespace_mapping_drops_real_letters(self):
  chrome=results('reader-record-space-map.json');pdfjs=results('pdfjs-browser-space-map.json')
  self.assertEqual([r['matchCollapsed'] for r in chrome],[True,False,False,True,True]);self.assertEqual([sum(s['match'] for s in r['selections']) for r in chrome],[8,5,5,8,8])
  self.assertIn('שלום',pdfjs[2]['source']);self.assertNotIn('שלום',pdfjs[2]['selectedText'].split('\n')[1]);self.assertIn('שלועול',pdfjs[2]['selectedText'])
  self.assertEqual(sum(r['matchCollapsed'] for r in pdfjs),1)
 def test_pdfjs_improvement_cannot_override_chrome_regression(self):
  chrome=results('reader-record-leading-space-hebrew-probe.json');pdfjs=results('pdfjs-browser-leading-space-hebrew-probe.json')
  self.assertEqual(len(chrome),1);self.assertEqual(len(pdfjs),1)
  self.assertTrue(pdfjs[0]['matchCollapsed']);self.assertFalse(chrome[0]['matchCollapsed']);self.assertEqual(sum(s['match'] for s in chrome[0]['selections']),5)
  baseline=next(r for r in results('reader-record-marked-boxes.json') if r['label']=='hebrew');self.assertTrue(baseline['matchCollapsed']);self.assertTrue(all(s['match'] for s in baseline['selections']))
 def test_readers_bound_to_exact_artifacts_without_runtime_errors(self):
  for name in ['reader-record-token-boundary.json','reader-record-space-map.json','reader-record-leading-space-hebrew-probe.json','pdfjs-browser-token-boundary.json','pdfjs-browser-space-map.json','pdfjs-browser-leading-space-hebrew-probe.json']:
   for r in results(name):
    self.assertNotIn('error',r);self.assertEqual(r.get('errors',[]),[]);self.assertEqual(sha(recorded_path(r['file'])),r.get('pdfSha256',r.get('sha256')))
if __name__=='__main__':unittest.main(verbosity=2)
