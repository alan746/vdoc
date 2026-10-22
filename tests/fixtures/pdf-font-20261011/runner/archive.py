from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageChops
import json,hashlib,unicodedata,collections,datetime,shutil
out=Path('tests/fixtures/pdf-font-20261011');now=datetime.datetime.now(datetime.timezone.utc).isoformat()
files=list(Path('output/pdf/pdf-font-20261011').glob('*.pdf'))+[Path('output/pdf/safari-native-20261011/sangam-native-100.pdf')]+[Path(f'output/pdf/safari-native-20261011/embedded-native-{s}.pdf') for s in [100,101,93]]
rows=[]
for p in files:
 r=PdfReader(p);t='\n'.join(x.extract_text() for x in r.pages);n=unicodedata.normalize('NFKC',t);fonts=collections.Counter()
 for page in r.pages:
  for f in page['/Resources'].get('/Font',{}).values():fonts[str(f.get_object().get('/Subtype'))]+=1
 rows.append(dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size,pages=len(r.pages),logicalHindiWords=t.count('हिन्दी'),cjkCodepoints=sum('\u3400'<=c<='\u9fff' for c in n),hindiCodepoints=sum('\u0900'<=c<='\u097f' for c in n),nullCodepoints=t.count('\0'),fontResourceSubtypes=dict(fonts)))
(out/'comparison.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
pixels=[]
for i in range(1,6):
 a=Image.open(out/f'renders/embedded-source-{i}.png').convert('RGB');b=Image.open(out/f'renders/embedded-logical-{i}.png').convert('RGB');pixels.append(a.size==b.size and ImageChops.difference(a,b).getbbox() is None)
audit=dict(at=now,productChanged=False,candidate='0a2386834f95c86adf6c8fd8fafbd0ab5b43ec6f281749da6eaaea9c85cb5ffd',pdfCount=len(files),renderedPages=35,scope='Fixture B diagnostic only. Post-pagination font substitution is not a product-safe typography policy or deployment solution.',finding='Type0 Sangam plus guarded Unicode repair preserves all Hindi after native Safari reprint; CJK initially still lost. Adding local Arial Unicode MS for CJK preserves all 206 CJK codepoints as well, with 18 logical Hindi words, at 100/101/93%. This is tested font-path evidence, not a universal Type3 rule.',fonts=dict(devanagari='Devanagari Sangam MN',cjk='Arial Unicode MS',use='Existing local macOS fonts for diagnosis; no font files copied into product or redistributed'),verification=dict(strictProductIndependentOracle=True,pdfjsCjkAndHindi=True,repairPixelIdentical=pixels,regressionTests=6,sourceJsonUnchanged=True,blockedExternalOrigins=[],visualReview='All five pages of direct and native100/101/93 contact sheets; native101 page1 at full render size. Rows, image, table endings, final body and footers present. Not native search/copy UI or all-script shaping certification.'),baselineCorrection='Original Safari b-100 PDF has Arabic inventory and logical Hindi order failures under stronger checks; old structural passes are not multilingual acceptance.',cleanup=dict(windows=[dict(id=2494,exists=False),dict(id=2580,exists=False)],nativeScaleRestored=100,server4189Stopped=True,main5173Preserved=True),gates='Q signed; I/P/S/F unsigned; no AI integration',next=['Verify fonts before pagination and no document/preview typography change.','Choose a supported local web runtime and font distribution policy; current Node/Chrome/Python tools are QA only.','Integrate actual export UI with cancellation and errors, then repeat native output and multilingual editing round trip.','Historical A source, IME candidate visibility and final joint signoff remain open.'],files=rows)
(out/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
runner=out/'runner';runner.mkdir(exist_ok=True)
for p in Path('tmp/pdf-font-20261011').iterdir():
 if p.suffix in ['.py','.mjs','.swift','.cjs']:shutil.copy2(p,runner/p.name)
print(json.dumps({'files':len(files),'pages':sum(r['pages'] for r in rows),'fontTypes':[{'file':Path(r['path']).name,'types':r['fontResourceSubtypes']} for r in rows]}))
