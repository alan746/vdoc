"""Regression coverage for conservative, document-wide ActualText mapping repair."""
import importlib.util,tempfile,unittest
from pathlib import Path
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,NameObject,TextStringObject
spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('repair-unicode.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE=Path('output/pdf/safari-fixed-pdf-20261011/prototype-b.pdf')
GOOD=Path('output/pdf/pdf-unicode-20261011/global-order-b.pdf')
class RepairTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory(prefix='vdoc-unicode-');self.root=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def mutate(self,mode):
  w=PdfWriter();w.clone_document_from_reader(PdfReader(SOURCE));p=w.pages[0];s=ContentStream(p.get_contents(),w)
  args=next(a for a,o in s.operations if o==b'BDC' and isinstance(a[1],dict) and a[1].get('/ActualText')=='हि')
  if mode=='outside':del args[1]['/ActualText']
  else:args[1][NameObject('/ActualText')]=TextStringObject('ह' if mode=='short' else 'िह')
  p[NameObject('/Contents')]=w._add_object(s);path=self.root/(mode+'.pdf')
  with path.open('wb') as f:w.write(f)
  return path
 def reject(self,mode):
  with self.assertRaises(ValueError):m.repair(self.mutate(mode),self.root/'out.pdf',True)
  self.assertFalse((self.root/'out.pdf').exists())
 def test_unannotated_reused_glyph_refused(self):self.reject('outside')
 def test_conflicting_cluster_refused(self):self.reject('conflict')
 def test_insufficient_unicode_refused(self):self.reject('short')
 def test_existing_output_preserved(self):
  before=GOOD.read_bytes()
  with self.assertRaisesRegex(ValueError,'overwrite'):m.repair(SOURCE,GOOD,True)
  self.assertEqual(GOOD.read_bytes(),before)
 def test_repair_is_idempotent(self):
  out=self.root/'repeat.pdf';r=m.repair(GOOD,out,True);self.assertEqual(r['edits'],[])
  self.assertEqual([p.extract_text() for p in PdfReader(GOOD).pages],[p.extract_text() for p in PdfReader(out).pages])
 def test_content_operators_preserved_and_unicode_order_fixed(self):
  before,after=PdfReader(SOURCE),PdfReader(GOOD)
  self.assertEqual([p.get_contents().get_data() for p in before.pages],[p.get_contents().get_data() for p in after.pages])
  self.assertEqual(sum(p.extract_text().count('हिन्दी') for p in after.pages),18)
  self.assertEqual(sum(p.extract_text().count('\0') for p in after.pages),0)
if __name__=='__main__':unittest.main(verbosity=2)
