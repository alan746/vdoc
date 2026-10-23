"""Validate real embedded-font controls; no variant is accepted from pixels alone."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import unittest,json,hashlib
from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('pdf-type0-minimal-20261011')
def read(name):return json.loads((FIX/name).read_text())
class EmbeddedFontControls(unittest.TestCase):
 def test_exact_embedded_font_cid_mapping_and_four_source_snapshots(self):
  rows=read('generated.json')['results']+read('generated-annotated.json')['results'];self.assertEqual(len(rows),4)
  for x in rows:
   p=recorded_path(x['file']);self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),x['sha256']);self.assertTrue(x['sourceUnchanged']);self.assertEqual(x['sourceText'],rows[0]['sourceText']);self.assertEqual(x['targets'],rows[0]['targets'])
   pdf=PdfReader(p);self.assertEqual(len(pdf.pages),1)
   font=next(iter(pdf.pages[0]['/Resources']['/Font'].values())).get_object();self.assertEqual(font['/Subtype'],'/Type0');cid=font['/DescendantFonts'][0].get_object();self.assertEqual(cid['/Subtype'],'/CIDFontType2')
   data=cid['/FontDescriptor']['/FontFile2'].get_object().get_data();self.assertEqual(hashlib.sha256(data).hexdigest(),x['fontSha256']);self.assertEqual(data,(recorded_path(x['fontFile'])).read_bytes())
   gids=cid['/CIDToGIDMap'].get_object().get_data();self.assertEqual(len(gids),2*(len(x['codes'])+1))
   for i,c in enumerate(x['codes'],1):self.assertEqual(int.from_bytes(gids[i*2:i*2+2],'big'),c['gid'])
 def test_four_identical_rasters_do_not_imply_text_correctness(self):
  rows=read('render-comparison.json');self.assertEqual(len(rows),4)
  for r in rows:self.assertTrue(r['pixelIdentical']);self.assertIsNone(ImageChops.difference(Image.open(recorded_path(r['render'])),Image.open(recorded_path(r['reference']))).getbbox())
 def test_readers_disagree_on_the_three_order_controls(self):
  chrome=read('chrome.json')['results'];pdfjs=read('pdfjs.json')['results']
  self.assertEqual([r['matchCollapsed'] for r in chrome],[True,False,False]);self.assertEqual([r['matchCollapsed'] for r in pdfjs],[False,False,True]);self.assertEqual([sum(s['match'] for s in r['selections']) for r in chrome],[11,4,11])
 def test_local_actualtext_variant_is_rejected_by_both_readers(self):
  self.assertFalse(read('chrome-annotated.json')['results'][0]['matchCollapsed']);self.assertFalse(read('pdfjs-annotated.json')['results'][0]['matchCollapsed']);self.assertEqual(sum(s['match'] for s in read('chrome-annotated.json')['results'][0]['selections']),4)
 def test_all_reader_artifacts_are_bound_and_runtime_error_free(self):
  for name in ['chrome.json','pdfjs.json','chrome-annotated.json','pdfjs-annotated.json']:
   for r in read(name)['results']:
    self.assertNotIn('error',r);self.assertEqual(r.get('errors',[]),[]);self.assertEqual(hashlib.sha256((recorded_path(r['file'])).read_bytes()).hexdigest(),r.get('sha256',r.get('pdfSha256')))
 def test_arabic_multi_glyph_guard_not_misreported_as_pass(self):
  r=read('arabic-cluster-guard.json');self.assertEqual(r['state'],'rejected-before-PDF-generation');self.assertEqual(r['word'],'اللغة');self.assertEqual(list((ROOT/'output/pdf/type0-minimal-20261011').glob('arabic*.pdf')),[])
if __name__=='__main__':unittest.main(verbosity=2)
