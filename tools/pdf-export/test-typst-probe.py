"""Actual offline browser compiler feasibility evidence; not product signoff."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import unittest,json,hashlib,base64
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('typst-browser-20261011')
def read(name):return json.loads((FIX/name).read_text())
class TypstProbe(unittest.TestCase):
 def test_registry_integrity_and_no_product_dependency(self):
  meta=json.loads((ROOT/'tmp/typst-qa-20261011/package-metadata.json').read_text());archive=(ROOT/'tmp/typst-qa-20261011/package.tgz').read_bytes()
  self.assertEqual(meta['version'],'0.7.0');algo,value=meta['dist']['integrity'].split('-',1);self.assertEqual(base64.b64encode(hashlib.new(algo,archive).digest()).decode(),value)
  pkg=json.loads((ROOT/'package.json').read_text());self.assertNotIn(meta['name'],pkg['dependencies']);self.assertNotIn(meta['name'],pkg['devDependencies'])
 def test_local_browser_compilation_and_three_embedded_outputs(self):
  r=read('generation.json');self.assertEqual(r['errors'],[]);self.assertEqual(len(r['results']),3)
  self.assertIn('/typst_ts_web_compiler_bg.wasm',r['requests']);self.assertTrue(all(x.startswith('/') for x in r['requests']))
  for item in r['results']:
   file=recorded_path(item['file']);self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),item['sha256']);self.assertEqual((FIX/(item['label']+'.typ')).read_text(),item['source']);p=PdfReader(file);self.assertEqual(len(p.pages),1)
   for ref in p.pages[0]['/Resources']['/Font'].values():
    f=ref.get_object();self.assertEqual(f['/Subtype'],'/Type0');d=f['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object();self.assertTrue('/FontFile2' in d or '/FontFile3' in d)
 def test_both_actual_readers_reject_all_three_full_texts(self):
  for name in ['chrome.json','pdfjs.json']:
   r=read(name)['results'];self.assertEqual(len(r),3);self.assertEqual([x['matchCollapsed'] for x in r],[False,False,False])
   for x in r:self.assertNotIn('error',x);self.assertEqual(x.get('errors',[]),[]);self.assertEqual(hashlib.sha256((recorded_path(x['file'])).read_bytes()).hexdigest(),x.get('sha256',x.get('pdfSha256')))
 def test_initial_loader_failure_preserved_and_no_pointer_claim(self):
  self.assertIn('without importer',str(read('generation-first.json')['errors']));self.assertEqual(read('generation-first.json')['results'],[])
  for r in read('chrome.json')['results']:self.assertEqual(r['selections'],[])
if __name__=='__main__':unittest.main(verbosity=2)
