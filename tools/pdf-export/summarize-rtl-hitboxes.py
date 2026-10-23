"""Bind owned QA artifacts and preserve negative results; never alter product gate status."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_name, recorded_path
import hashlib,json,shutil
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('reader-control-20261011');OUT=FIX/'rtl-hitboxes-audit.json'
if OUT.exists():raise SystemExit('Refuse overwrite audit')
def read(name):return json.loads((FIX/name).read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(name):return {r['label']:r for r in read(name)['results']}
files=set();modes=('record-rtl','record-boxes','record-alef');pdfs=[];readers={};partials={}
for mode in modes:
 r=rows(f'reader-{mode}.json');readers[mode]={'fullPass':sum(x['matchCollapsed'] for x in r.values()),'fullTotal':len(r),'wordPass':sum(p['match'] for x in r.values() for p in x['selections']),'wordTotal':sum(len(x['selections']) for x in r.values())}
 files.update([FIX/f'reader-{mode}.json',FIX/f'{mode}-pdfjs.json'])
 for x in r.values():pdfs.append(recorded_path(x['file']))
for stem in ('words-unicode-ordered-safety-record-actual','arabic-unicode-ordered-safety-record-alef'):pdfs.append(ROOT/'output/pdf/browser-unicode-20261011'/(stem+'.pdf'))
for pdf in pdfs:
 files.update([pdf,FIX/(pdf.stem+'-render.png'),qa_path('browser-unicode-20261011')/(pdf.stem+'-report.json'),qa_path('browser-unicode-20261011')/(pdf.stem+'-browser.png')])
for mode,inset in [('record-rtl',False),('record-boxes',False),('record-alef',False),('record-boxes',True),('record-actual',True),('record-alef',True)]:
 suffix='-inset1' if inset else '';key=mode+suffix;name=f'partial-{mode}-wide-standards{suffix}.json';r=rows(name)
 files.add(FIX/name);partials[key]=[{'label':x['label'],'passed':sum(p['match'] for p in x['selections']),'total':len(x['selections'])} for x in r.values()]
 for x in r.values():
  files.update([FIX/f"partial-{mode}-wide-standards{suffix}-{x['label']}.png",FIX/f"source-{mode}-wide-standards{suffix}-{x['label']}.png"])
comparisons=[]
for inset in (False,True):
 suffix='-inset1' if inset else '';old=rows(f'partial-record-actual-wide-standards{suffix}.json');new=rows(f'partial-record-alef-wide-standards{suffix}.json');fixed=[];regressions=[]
 for label in old:
  for a,b in zip(old[label]['selections'],new[label]['selections']):
   if not a['match'] and b['match']:fixed.append({'label':label,'line':b['line'],'word':b['word'],'expected':b['expected'],'before':a['selectedText'],'after':b['selectedText']})
   if a['match'] and not b['match']:regressions.append({'label':label,'case':b})
 comparisons.append({'requestedInsetCssPx':1 if inset else .15,'fixed':fixed,'regressions':regressions})
 files.add(FIX/f'partial-record-actual-wide-standards{suffix}.json')
for mode in ('record-boxes','record-alef'):
 files.update([FIX/f'search-{mode}.json',FIX/f'search-{mode}-highlight-audit.json'])
 for x in read(f'search-{mode}-highlight-audit.json')['results']:
  files.update(recorded_path(s['file']) for s in x['screenshots'])
files.update(FIX/n for n in ['rtl-hitboxes-render-comparison.json','alef-render-comparison.json','alef-ink-geometry.json','rtl-hitboxes-regressions.log','rtl-hitboxes-regressions-initial-assertion.log','cluster-annotations-recheck-after-hitboxes.log','review-record-rtl-renders.png','review-record-boxes-renders.png','review-rtl-search-highlights.png'])
snap=FIX/'rtl-hitboxes-tools';snap.mkdir(exist_ok=False)
for name in ['browser-record-rtl-prototype.js','browser-record-boxes-prototype.js','browser-record-alef-prototype.js','run-browser-unicode.cjs','check-reader-bidi-runs.cjs','check-partial-bidi-runs.cjs','check-search-bidi-runs.cjs','verify-bidi-runs.mjs','audit-search-bidi-runs.py','inspect-ink-geometry.py','test-rtl-hitboxes.py','summarize-rtl-hitboxes.py']:
 target=snap/name;shutil.copy2(ROOT/'tools/pdf-export'/name,target);files.add(target)
for p in files:
 if not p.exists():raise ValueError('Missing evidence '+str(p))
for name,n in [('rtl-hitboxes-regressions.log',13),('cluster-annotations-recheck-after-hitboxes.log',12)]:
 text=(FIX/name).read_text();assert f'Ran {n} tests' in text and text.rstrip().endswith('OK')
result={'at':datetime.now(timezone.utc).isoformat(),'scope':'QA-only single-page font/selection research. No product code/dependency/export UI changes. Not AI or gate signoff.','counts':{'newPdfs':len(pdfs),'renderedPages':len(pdfs),'actualFullCopies':15,'actualWordSelections':120,'actualPartialDrags':sum(x['total'] for r in partials.values() for x in r),'positiveAbsentSearchPairs':10,'guardChecks':14,'downloadHashChecks':2,'newArtifactRegressions':13,'retainedArtifactRegressions':12},'readers':readers,'partialResults':partials,'baselineComparison':comparisons,'candidate':'browser-record-alef-prototype.js','candidateLimit':'Narrow alef/lam hit-box representation in unmarked Arabic words. Not a general RTL or ligature algorithm. Marked words and other scripts retain record-actual.','rejected':['record-rtl breaks marked full-copy and word selection','record-boxes regresses already-passing edge-adjacent ranges despite some improvements; internal insets still expose mark losses'],'pointerLimits':'Keep 0.15px near-edge and 1px interior-pointer results separately. 1px is capped at a quarter range width. Do not combine successes, silently replace failures or declare edge failures fixed by test changes.','remaining':'46/318 edge-adjacent cases fail; interior marked RTL failures also retained. PDF.js strict RTL text/word separators fail. pypdf compatibility, production fonts/styles/multipage/images and native Safari reprint are not signed.','visual':'All 17 pages rendered. New RTL/broad sets visually inspected in contact sheets; final targeted Arabic pages and ten positive search crops inspected. Unchanged final Hindi/Hebrew pages and safety duplicates verified by pixel equality. Final exact visible vector-path multisets and placement match baseline (<0.0001 PDF units), but two main Arabic renders are not pixel-identical. No global pixel-identity claim.','testCorrection':'Initial negative-control assertion incorrectly expected a regression at the 1px inset; raw evidence shows regression at 0.15px. Assertion corrected to the matching comparison; initial failed test log retained. No browser result altered.','research':[{'url':'https://chromium.googlesource.com/chromium/src/+/main/pdf/pdfium/pdfium_engine.cc','note':'GetCharIndexBasedOnPointData examines individual character direction; main source is an explanatory hypothesis, not pinned Chrome 154 source or proof of all residual failures.'},{'url':'https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fpdftext/cpdf_textpage.cpp','note':'GetIndexAtPos uses character boxes. Version limitation same as above.'}],'candidateFingerprint':'0a2386834f95c86adf6c8fd8fafbd0ab5b43ec6f281749da6eaaea9c85cb5ffd','ledgerUnchanged':{'已核验':187,'组件通过':59,'用户已确认':1,'待执行':62,'阻塞':5,'未通过':5,'不适用':1},'cleanup':'All owned isolated Chrome contexts and local servers closed by finally blocks; no personal Safari/clipboard accessed; localhost:5173 unchanged.','artifacts':[{'file':recorded_name(p),'sha256':sha(p)} for p in sorted(files)]}
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(result['counts']);print('artifacts',len(files));print('fixed/regressions',[(len(c['fixed']),len(c['regressions'])) for c in comparisons])
