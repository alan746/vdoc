"""Real Safari paint/hit-test regression. Own session, fixed QA document only."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path
import json
import socket
import subprocess
import time
import urllib.error
from pathlib import Path
from safari_acceptance import Safari, ELEMENT, FIXTURE

OUT = qa_path('safari-pinned-paint-20261010')
OUT.mkdir(exist_ok=True)
driver = Safari(4181)
report = {'checks': [], 'state': 'running'}
with socket.socket() as port:
    if port.connect_ex(('127.0.0.1', 4181)) == 0:
        raise RuntimeError('Refusing to attach to an occupied driver port')
process = subprocess.Popen(['/usr/bin/safaridriver', '--port', '4181'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            driver.request('GET', '/status', session=False)
            break
        except urllib.error.URLError:
            time.sleep(.1)
    session = driver.request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}}, session=False)
    driver.session = session['sessionId']
    report['capabilities'] = session['capabilities']
    driver.request('POST', '/window/rect', {'width': 1470, 'height': 920})
    driver.request('POST', '/url', {'url': 'http://localhost:5173/'})
    driver.wait('''return !!document.querySelector('input[aria-label="Import file into library"]:not(:disabled)')''')
    upload = driver.find('input[aria-label="Import file into library"]')
    driver.request('POST', '/element/' + upload[ELEMENT] + '/value', {'text': str(FIXTURE)})
    before = driver.wait('return window.vdoc?.snapshot().document || null')
    current = 100
    for zoom in [75, 100, 125]:
        driver.button(str(current) + '%')
        item = driver.wait('''return [...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()===''' + json.dumps(str(zoom) + '%') + ') || null')
        driver.click(item)
        driver.wait('''return !document.querySelector('[role="menuitem"]')''')
        current = zoom
        for place in ['start', 'middle', 'end']:
            driver.js('''const c=document.querySelector('.canvas-scroll'),t=document.querySelector('.document-editor table');
              const r=t.getBoundingClientRect(),top=document.querySelector('.paragraph-ruler').getBoundingClientRect().bottom;
              c.scrollTop+=arguments[0]==='start'?r.top-top-30:arguments[0]==='middle'?r.top+r.height/2-top:r.bottom-top-120;''', place)
            time.sleep(.35)
            cells = driver.js('''return [...document.querySelectorAll('.document-editor .vdoc-pinned-row > th,.document-editor .vdoc-pinned-row > td')].map(cell=>{
              const r=cell.getBoundingClientRect();return {text:cell.textContent,rect:r.toJSON(),hits:[.25,.5,.75].map(x=>
                document.elementFromPoint(r.left+r.width*x,r.top+r.height*.5)?.closest('td,th')===cell)};});''')
            assert len(cells) == 2 and all(all(cell['hits']) for cell in cells), (zoom, place, cells)
            rect = cells[0]['rect']
            x, y = round(rect['left'] + 35), round(rect['top'] + rect['height'] / 2)
            driver.request('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'qa-mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerMove', 'origin': 'viewport', 'x': 25, 'y': 500, 'duration': 0},
                {'type': 'pointerMove', 'origin': 'viewport', 'x': x, 'y': y, 'duration': 100}]}]})
            handle = driver.wait('''const e=document.querySelector('[aria-label="Row 1 actions"]');return e?.getBoundingClientRect().toJSON() || null''')
            assert abs(handle['top'] - (rect['top'] + 6)) < 2, (handle, rect)
            driver.request('POST', '/actions', {'actions': [{'type': 'pointer', 'id': 'qa-mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
                {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}]}]})
            selection = driver.js('''const n=getSelection()?.anchorNode;return (n?.nodeType===1?n:n?.parentElement)?.closest('th,td')?.textContent;''')
            assert selection == 'Group 中文', selection
            assert driver.js('return window.vdoc.snapshot().document') == before
            driver.screenshot(OUT / f'fixed-{zoom}-{place}.png')
            report['checks'].append({'zoom': zoom, 'position': place, 'cells': cells, 'handle': handle, 'nativeClickSelection': selection, 'fullJSONUnchanged': True})
            print(f'{zoom}% {place}: paint, hit-test, native click, row tools, full JSON passed', flush=True)
    driver.request('POST', '/refresh', {})
    assert driver.wait('return window.vdoc?.snapshot().document || null') == before
    report['reloadFullJSONUnchanged'] = True
    report['state'] = 'passed'
except Exception as error:
    if driver.session:
        driver.screenshot(OUT / 'failure.png')
        report['failureDOM'] = driver.js("return {tools:[...document.querySelectorAll('.table-hover-tools')].map(e=>e.outerHTML),selection:getSelection()?.toString(),hit:document.elementFromPoint(480,280)?.outerHTML}")
    report['state'] = 'failed'
    report['error'] = str(error)
    raise
finally:
    if driver.session:
        try:
            driver.request('DELETE', '')
            report['ownSessionClosed'] = True
        except Exception as error:
            report['cleanupError'] = str(error)
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    (OUT / 'regression.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
