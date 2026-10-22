import importlib.util,json,logging
from pathlib import Path
logging.getLogger('pypdf').setLevel(logging.ERROR);logging.getLogger('pdfminer').setLevel(logging.ERROR)
spec=importlib.util.spec_from_file_location('v','tools/pdf-export/verify-acceptance.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
files=[*sorted(Path('output/pdf/safari-native-20261011').glob('b-*.pdf')),*sorted(Path('output/pdf/safari-native-20261011').glob('fixed-handoff-*.pdf')),*sorted(Path('output/pdf/safari-fixed-pdf-20261011').glob('prototype-*.pdf')),*sorted(Path('output/pdf/safari-native-20261011').glob('prototype-native-*.pdf'))]
results=[m.verify(f) for f in files]
for r in results:print(Path(r['file']).name,r['passed'],r['failures'][:2])
Path('tests/fixtures/safari-fixed-pdf-20261011/regression.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
assert any(not r['passed'] and Path(r['file']).name.startswith('b-101') for r in results)
assert all(r['passed'] for r in results if Path(r['file']).name.startswith('fixed-handoff'))
