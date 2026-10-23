"""QA paths, independent of cwd; shares configuration with the JavaScript tools."""
import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CONFIG = json.loads(Path(__file__).with_name('qa-paths.json').read_text())
EVIDENCE_ROOT = Path(os.path.abspath(PROJECT_ROOT / (os.environ.get('VDOC_QA_EVIDENCE') or _CONFIG['evidenceDirectory'])))
FIXTURE_ROOT = PROJECT_ROOT.joinpath(*_CONFIG['fixtureDirectory'])
_RETAINED = frozenset(_CONFIG['retainedFixtureDirectories'])


def qa_path(relative=''):
    normalized = str(relative).replace('\\', '/')
    root = FIXTURE_ROOT if normalized.split('/')[0] in _RETAINED else EVIDENCE_ROOT
    return root / normalized


def recorded_path(relative):
    """Resolve immutable historical report paths without modifying their bytes."""
    normalized = str(relative).replace('\\', '/')
    prefix = '/'.join(_CONFIG['fixtureDirectory']) + '/'
    if normalized.startswith(prefix):
        return qa_path(normalized[len(prefix):])
    evidence_prefix = _CONFIG['evidenceDirectory'] + '/'
    return EVIDENCE_ROOT / normalized[len(evidence_prefix):] if normalized.startswith(evidence_prefix) else PROJECT_ROOT / normalized


def recorded_name(path):
    """Portable logical path for newly generated reports, including external roots."""
    absolute = Path(os.path.abspath(path))
    try:
        return str(Path(_CONFIG['evidenceDirectory']) / absolute.relative_to(EVIDENCE_ROOT))
    except ValueError:
        return str(absolute.relative_to(PROJECT_ROOT))
