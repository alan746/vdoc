"""Small corruption checks for the read-only evidence verifier; no archive download."""
import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('verify_evidence', Path(__file__).with_name('verify-qa-evidence.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ArchiveIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'evidence.tar.gz'
        data = b'original historical evidence\n'
        self.record = {'path': 'qa-evidence/example/audit.json', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        with tarfile.open(self.archive, 'w:gz') as package:
            info = tarfile.TarInfo(self.record['path']); info.size = len(data)
            package.addfile(info, io.BytesIO(data))
        self.manifest = {'archiveSHA256': hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'files': [self.record]}
        path = self.root / 'example/audit.json'; path.parent.mkdir(); path.write_bytes(data)

    def test_archive_and_restored_tree_match(self):
        self.assertEqual(verifier.verify(self.manifest, archive=self.archive), 1)
        self.assertEqual(verifier.verify(self.manifest, root=self.root), 1)

    def test_corrupted_archive_is_rejected(self):
        self.archive.write_bytes(self.archive.read_bytes() + b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Archive SHA-256'):
            verifier.verify(self.manifest, archive=self.archive)

    def test_missing_inventory_member_is_rejected(self):
        self.manifest['files'] = []
        with self.assertRaisesRegex(ValueError, 'inventory'):
            verifier.verify(self.manifest, archive=self.archive)

    def test_changed_extracted_bytes_are_rejected(self):
        (self.root / 'example/audit.json').write_bytes(b'rewritten evidence')
        with self.assertRaisesRegex(ValueError, 'Content mismatch'):
            verifier.verify(self.manifest, root=self.root)


if __name__ == '__main__':
    unittest.main()
