"""Compare only the document page; reader toolbar/thumbnail loading is not a search result."""
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'tests/fixtures/reader-control-20261011'

def audit(encoding="bidi-runs"):
    if encoding not in ("bidi-runs", "local-clusters", "record-actual", "record-boxes", "record-alef", "record-digits", "record-flow", "record-number-tail"):
        raise ValueError("Unsupported search evidence set")
    results = []
    for row in json.loads((FIX / f'search-{encoding}.json').read_text())['results']:
        label = row['label']
        paths = {n: FIX / f"search-{'' if encoding=='bidi-runs' else encoding+'-'}{label}-{n}.png" for n in ('before', 'match', 'absent')}
        imgs = {n: Image.open(p).convert('RGB') for n, p in paths.items()}
        r, sc, t = row['geometry']['rect'], row['geometry']['scroller'], row['target']['rect']
        # Exclude PDF viewer chrome using geometry captured independently before search.
        crop = (math.ceil(sc['x']+r['x']), math.ceil(sc['y']+r['y']), math.floor(sc['x']+r['x']+r['width']), math.floor(sc['y']+r['y']+r['height']))
        diff = ImageChops.difference(imgs['before'].crop(crop), imgs['match'].crop(crop)).getbbox()
        bbox = [diff[0]+crop[0], diff[1]+crop[1], diff[2]+crop[0], diff[3]+crop[1]] if diff else None
        negativeDiff = ImageChops.difference(imgs['before'].crop(crop), imgs['absent'].crop(crop))
        negative = negativeDiff.getbbox()
        maxNegativeDelta = max(max(channel) for channel in negativeDiff.getextrema())
        def highlight_count(image):
            return sum(1 for r,g,b in image.crop(crop).get_flattened_data() if b>r+10 and r>g+10 and r>150)
        highlights = {name:highlight_count(image) for name,image in imgs.items()}
        sx, sy = r['width']/794, r['height']/1123
        target = [sc['x']+r['x']+t['x']*sx, sc['y']+r['y']+t['y']*sy, sc['x']+r['x']+(t['x']+t['width'])*sx, sc['y']+r['y']+(t['y']+t['height'])*sy]
        contained = bool(bbox and bbox[0]>=target[0]-2 and bbox[1]>=target[1]-2 and bbox[2]<=target[2]+2 and bbox[3]<=target[3]+2)
        results.append({'label':label,'pdfSha256':row['sha256'],'query':row['query'],'pageCrop':crop,'positiveDifferenceBounds':bbox,'sourceWordScreenBounds':target,'highlightContainedInTarget':contained,'negativeDifferenceBounds':negative,'negativeExactlyIdentical':negative is None,'maxNegativeChannelDelta':maxNegativeDelta,'highlightPixelCounts':highlights,'negativeClearsHighlight':highlights['before']==0 and highlights['absent']==0 and maxNegativeDelta<=1,'screenshots':[{'file':str(p.relative_to(ROOT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths.values()]})
    return {'scope':'Whole-word PDF plugin text-fragment lookup; not Cmd-F UI, editor search, or character selection. Page-only pixel comparisons exclude asynchronous reader toolbar/thumbnail loading. All five positive screenshots visually inspected. Negative criterion: zero lavender pixels and at most 1/255 per-channel difference from initial page; exact equality also recorded.','rawMethodCorrection':'Raw top-level double-click method label was inherited incorrectly; per-result methods and the search tool describe the actual text-fragment calls. Raw report retained.','excludedInvalidComparison':'search-bidi-runs-pixels.json compared the whole browser including loading toolbar/thumbnail and is not a valid search verdict.','results':results}

if __name__ == '__main__':
    import os
    encoding=os.environ.get('VDOC_QA_READER_VARIANT','bidi-runs')
    result = audit(encoding)
    if encoding!='bidi-runs':
        result['rawMethodCorrection']='Not needed: current report labels the text-fragment method correctly.'
        result['excludedInvalidComparison']='Earlier bidi-runs whole-window comparison excluded; no such comparison used in this run.'
    dest = FIX / f'search-{encoding}-highlight-audit.json'
    if dest.exists():
        raise SystemExit('Refuse overwrite')
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    for row in result['results']:
        print(row['label'],row['highlightContainedInTarget'],row['negativeClearsHighlight'],row['positiveDifferenceBounds'])
