"""Verify the immutable archive, or an extracted evidence root, against its manifest."""
import argparse
import hashlib
import json
import tarfile
from pathlib import Path


def digest(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()


def verify(manifest, archive=None, root=None):
    records = manifest['files']
    if archive:
        with archive.open('rb') as stream:
            if digest(stream) != manifest['archiveSHA256']:
                raise ValueError('Archive SHA-256 does not match the manifest')
        with tarfile.open(archive, 'r:gz') as package:
            members = package.getmembers()
            expected = {record['path']: record for record in records}
            if len(members) != len(expected) or {m.name for m in members} != expected.keys():
                raise ValueError('Archive file inventory differs from the manifest')
            for member in members:
                record = expected[member.name]
                if not member.isfile() or member.size != record['bytes']:
                    raise ValueError(f'Unexpected archive member: {member.name}')
                with package.extractfile(member) as stream:
                    if digest(stream) != record['sha256']:
                        raise ValueError(f'Content mismatch: {member.name}')
    else:
        for record in records:
            relative = Path(record['path']).relative_to('qa-evidence')
            path = root / relative
            with path.open('rb') as stream:
                if path.stat().st_size != record['bytes'] or digest(stream) != record['sha256']:
                    raise ValueError(f'Content mismatch: {path}')
    return len(records)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/QA_EVIDENCE_MANIFEST.json')
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--archive', type=Path)
    target.add_argument('--root', type=Path)
    args = parser.parse_args()
    count = verify(json.loads(args.manifest.read_text()), args.archive, args.root)
    print(f'Verified {count} unchanged evidence files')
