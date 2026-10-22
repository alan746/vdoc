"""Run with bundled Python (pypdf), from the repository root. No browser needed."""
import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, DictionaryObject, NameObject, TextStringObject
spec = importlib.util.spec_from_file_location('normalizer', Path(__file__).with_name('normalize-actual-text.py'))
n = importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
SOURCE = Path('output/pdf/safari-fixed-pdf-20261011/prototype-b.pdf')
NORMAL = Path('output/pdf/pdf-unicode-20261011/normalized-b.pdf')

class ActualTextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='vdoc-pdf-test-')
        self.root = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def mutate(self, mode):
        w = PdfWriter();w.clone_document_from_reader(PdfReader(SOURCE))
        page = w.pages[0];stream = ContentStream(page.get_contents(), w)
        index = next(i for i,(args,op) in enumerate(stream.operations) if op == b'BDC' and isinstance(args[1],dict) and args[1].get('/ActualText') == 'हि')
        if mode == 'too-short':
            stream.operations[index][0][1][NameObject('/ActualText')] = TextStringObject('ह')
        elif mode == 'nested':
            stream.operations.insert(index+1, ([NameObject('/Span'), DictionaryObject({NameObject('/ActualText'):TextStringObject('हि')})], b'BDC'))
        elif mode == 'invalid-unicode':
            stream.operations[index][0][1][NameObject('/ActualText')] = TextStringObject('\x00')
        page[NameObject('/Contents')] = w._add_object(stream)
        path = self.root / (mode + '.pdf')
        with path.open('wb') as f:w.write(f)
        return path
    def test_short_cluster_refused_without_output(self):
        with self.assertRaisesRegex(ValueError, 'empty glyph mappings'):
            n.normalize(self.mutate('too-short'), self.root/'out.pdf')
        self.assertFalse((self.root/'out.pdf').exists())
    def test_nested_cluster_refused_without_output(self):
        with self.assertRaisesRegex(ValueError, 'Nested ActualText'):
            n.normalize(self.mutate('nested'), self.root/'out.pdf')
        self.assertFalse((self.root/'out.pdf').exists())
    def test_invalid_unicode_refused_without_output(self):
        with self.assertRaisesRegex(ValueError, 'empty glyph mappings'):
            n.normalize(self.mutate('invalid-unicode'), self.root/'out.pdf')
        self.assertFalse((self.root/'out.pdf').exists())
    def test_existing_file_preserved(self):
        before = NORMAL.read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite'):
            n.normalize(SOURCE, NORMAL)
        self.assertEqual(before, NORMAL.read_bytes())
    def test_repeat_normalization_is_semantically_idempotent(self):
        target = self.root/'repeat.pdf'
        result = n.normalize(NORMAL, target)
        self.assertEqual(result['clusters'], [])
        before, after = PdfReader(NORMAL), PdfReader(target)
        self.assertEqual([p.extract_text() for p in before.pages], [p.extract_text() for p in after.pages])
        self.assertEqual([p.get_contents().get_data() for p in before.pages], [p.get_contents().get_data() for p in after.pages])
    def test_initial_repair_does_not_claim_logical_order(self):
        old=PdfReader('output/pdf/pdf-unicode-20261011/repaired-b.pdf')
        new=PdfReader(NORMAL)
        self.assertEqual(sum(p.extract_text().count('हिन्दी') for p in old.pages),0)
        self.assertEqual(sum(p.extract_text().count('हिन्दी') for p in new.pages),18)

if __name__ == '__main__':unittest.main(verbosity=2)
