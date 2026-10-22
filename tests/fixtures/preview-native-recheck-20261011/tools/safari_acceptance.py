"""Own a fresh Safari WebDriver session; never attach to normal Safari windows.

This checks browser preview and persistence, not OS IME or the native print dialog.
Run from the repository root. Only the fixed local QA fixture is imported.
"""
import argparse
import base64
import datetime
import hashlib
import json
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/fixtures/safari-preview/source.vdoc.json'
MANIFEST = ROOT / 'tests/fixtures/safari-pinned-paint-20261010/source-manifest.json'
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


class DriverError(RuntimeError):
    def __init__(self, data):
        self.data = data
        super().__init__(json.dumps(data, ensure_ascii=False))


class Safari:
    def __init__(self, port):
        self.base = f'http://127.0.0.1:{port}'
        self.session = None

    def request(self, method, path, data=None, session=True):
        prefix = '/session/' + self.session if session and self.session else ''
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.base + prefix + path, data=body,
                                         method=method, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response).get('value')
        except urllib.error.HTTPError as error:
            raise DriverError(json.loads(error.read())) from error

    def js(self, script, *args):
        return self.request('POST', '/execute/sync', {'script': script, 'args': list(args)})

    def find(self, selector):
        return self.request('POST', '/element', {'using': 'css selector', 'value': selector})

    def click(self, element):
        self.request('POST', '/element/' + element[ELEMENT] + '/click', {})

    def button(self, name):
        element = self.js('return [...document.querySelectorAll("button")].find(e => '
                          '(e.getAttribute("aria-label") || e.textContent.trim()) === arguments[0]) || null', name)
        if not element:
            raise RuntimeError('Button not found: ' + name)
        self.click(element)

    def wait(self, script, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            value = self.js(script)
            if value:
                return value
            time.sleep(.25)
        raise TimeoutError('Timed out: ' + script[:180])

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.request('GET', '/screenshot')))

    def keys(self, *values):
        actions = [{'type': 'keyDown', 'value': value} for value in values]
        actions += [{'type': 'keyUp', 'value': value} for value in reversed(values)]
        self.request('POST', '/actions', {'actions': [{'type': 'key', 'id': 'vdoc-keyboard', 'actions': actions}]})


def normalized(value):
    # Import intentionally assigns new block IDs. Compare everything else.
    if isinstance(value, dict):
        return {key: normalized(item) for key, item in value.items() if key != 'blockId'}
    if isinstance(value, list):
        return [normalized(item) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate inputs only; no browser or acceptance pass')
    parser.add_argument('--manifest', type=Path, default=MANIFEST,
                        help='Explicit candidate manifest; the default remains the historical baseline')
    parser.add_argument('--port', type=int, default=4181)
    parser.add_argument('--extended', action='store_true', help='Search/zoom, last-page navigation, and PDF capability probe')
    parser.add_argument('--native-print', action='store_true', help='Keep this owned preview alive up to 10 minutes for native print UI checks')
    parser.add_argument('--probe-print', action='store_true', help='Explicitly recheck optional WebDriver PDF command support')
    args = parser.parse_args()
    fixture = json.loads(FIXTURE.read_text())
    manifest = json.loads(args.manifest.read_text())
    for item in manifest['files']:
        actual = hashlib.sha256((ROOT / item['file']).read_bytes()).hexdigest()
        if actual != item['sha256']:
            raise RuntimeError('Candidate changed: ' + item['file'] + '; refresh source manifest first')
    if args.check:
        print('Inputs and candidate fingerprint valid. No browser acceptance performed.')
        return
    # Do not accidentally reuse someone else's WebDriver server.
    with socket.socket() as connection:
        if connection.connect_ex(('127.0.0.1', args.port)) == 0:
            raise RuntimeError('Port already occupied; refusing to attach')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = ROOT / 'tests/fixtures/safari-webdriver' / stamp
    output.mkdir(parents=True)
    report = {'at': stamp, 'state': 'started', 'applicationSha256': manifest['applicationSha256'],
              'fixtureSha256': hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), 'checks': [],
              'scope': 'Fresh isolated Safari browser; preview and saved JSON only',
              'exclusions': ['System IME candidate UI', 'Native Safari print dialog and PDF scales',
                             'Historical project-plan source pairing']}
    driver = Safari(args.port)
    process = None
    try:
        with (output / 'driver.log').open('w') as log:
            process = subprocess.Popen(['/usr/bin/safaridriver', '--port', str(args.port)], stdout=log, stderr=log)
            for _ in range(50):
                if process.poll() is not None:
                    raise RuntimeError('Own safaridriver exited before readiness')
                try:
                    driver.request('GET', '/status', session=False)
                    break
                except urllib.error.URLError:
                    time.sleep(.1)
            session = driver.request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}}, session=False)
            driver.session = session['sessionId']
            report['capabilities'] = session.get('capabilities')
            driver.request('POST', '/timeouts', {'implicit': 0, 'pageLoad': 45000, 'script': 30000})
            driver.request('POST', '/url', {'url': 'http://localhost:5173/'})
            driver.wait('''return !!document.querySelector('input[aria-label="Import file into library"]:not(:disabled)')''')
            upload = driver.find('input[aria-label="Import file into library"]')
            driver.request('POST', '/element/' + upload[ELEMENT] + '/value', {'text': str(FIXTURE)})
            before = driver.wait('return window.vdoc?.snapshot().document || null')
            assert normalized(before) == normalized(fixture['content']), 'Import changed fixture content'
            (output / 'imported-document.json').write_text(json.dumps(before, ensure_ascii=False, indent=2))
            report['checks'].append({'name': 'import-content', 'passed': True})
            report['documentURL'] = driver.request('GET', '/url')
            if args.extended:
                driver.click(driver.find('[role="textbox"][aria-label="Document body"]'))
                driver.keys('\ue03d', 'f')
                driver.wait('''return !!document.querySelector('input[aria-label="Find text"]')''')
                find = driver.find('input[aria-label="Find text"]')
                driver.request('POST', '/element/' + find[ELEMENT] + '/value', {'text': 'FINAL PAGE CHECK'})
                for zoom in [100, 125, 100]:
                    if zoom != 100 or report['checks'][-1]['name'] == 'search-125':
                        current = 100 if zoom == 125 else 125
                        driver.button(str(current) + '%')
                        item = driver.wait('''return [...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()===''' + json.dumps(str(zoom) + '%') + ') || null')
                        driver.click(item)
                        driver.wait('''return !document.querySelector('[role="menuitem"]')''')
                    geometry = driver.wait('''const m=document.querySelector('.vdoc-search-current');
                      const c=document.querySelector('.canvas-scroll'); if(!m || !c)return null;
                      const r=m.getBoundingClientRect(), b=c.getBoundingClientRect();
                      return r.top>=b.top && r.bottom<=b.bottom && r.left>=b.left && r.right<=b.right ?
                        {match:r.toJSON(),canvas:b.toJSON(),text:m.textContent,status:document.querySelector('.find-panel [role="status"]')?.textContent}:null;''')
                    assert geometry['text'] == 'FINAL PAGE CHECK'
                    assert geometry['status'] == '1 of 1'
                    assert driver.js('return window.vdoc.snapshot().document') == before
                    driver.screenshot(output / f'search-{zoom}.png')
                    report['checks'].append({'name': f'search-{zoom}', 'passed': True, 'geometry': geometry})
                # Leave the search active and zoom at 125% when opening Print.
                driver.button('100%')
                item = driver.wait('''return [...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='125%') || null''')
                driver.click(item)
                driver.wait('''return !document.querySelector('[role="menuitem"]')''')
            for attempt in range(1, 2 if args.native_print else 4):
                preview_started = time.monotonic()
                driver.button('Print')
                ready = driver.wait('''const s=document.querySelector('.print-preview-controls [role="status"]')?.textContent;
                  const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Print / Save PDF');
                  if(s && !s.includes('Preparing') && (!b || b.disabled)) throw Error(s);
                  return b && !b.disabled ? s : null;''', seconds=65)
                frame = driver.find('iframe[title="Paginated document preview"]')
                driver.request('POST', '/frame', {'id': frame})
                pages = driver.js('''return [...document.querySelectorAll('#preview-pages .pagedjs_page')].map(p=>({
                  text:p.querySelector('.pagedjs_page_content')?.innerText || '',
                  images:[...p.querySelectorAll('img')].map(i=>({complete:i.complete,width:i.naturalWidth})),
                  label:p.getAttribute('aria-label')}))''')
                assert len(pages) == 5, f'Expected 5 pages, got {len(pages)}'
                body = '\n'.join(page['text'] for page in pages)
                counts = {f'{n:02}': len(re.findall(r'ROW\s+' + f'{n:02}' + r'\b', body)) for n in range(1, 37)}
                assert all(value == 1 for value in counts.values()), counts
                assert 'FINAL PAGE CHECK' in pages[-1]['text'], 'Last page marker missing'
                assert any(image['complete'] and image['width'] > 0 for page in pages for image in page['images']), 'Image not loaded'
                driver.request('POST', '/frame', {'id': None})
                driver.screenshot(output / f'preview-{attempt}.png')
                if args.native_print:
                    control = {'session': driver.session, 'port': args.port, 'url': report['documentURL'],
                               'output': str(output), 'driverPid': process.pid, 'ownerPid': __import__('os').getpid()}
                    (ROOT / 'tmp/safari-driver/native-control.json').write_text(json.dumps(control, indent=2))
                    (output / 'report-in-progress.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
                    print('OWNED_NATIVE_PREVIEW_READY ' + str(output), flush=True)
                    deadline = time.monotonic() + 600
                    while time.monotonic() < deadline and not (output / 'native-done').exists():
                        time.sleep(1)
                    if not (output / 'native-done').exists():
                        raise TimeoutError('Native print hold expired; closing only owned session')
                if args.extended:
                    # WebDriver's option click selects through the browser;
                    # macOS popup menus do not implement an End key uniformly.
                    driver.click(driver.find('select[aria-label="Go to page"] option[value="5"]'))
                    driver.wait('''return document.querySelector('select[aria-label="Go to page"]').value==='5' ''')
                    driver.request('POST', '/frame', {'id': frame})
                    last = driver.wait('''const p=document.querySelector('.pagedjs_page:last-child');
                      const r=p?.getBoundingClientRect();return r && r.top>=-2 && r.top<innerHeight ? {top:r.top,text:p.innerText}:null;''')
                    assert 'FINAL PAGE CHECK' in last['text']
                    report['checks'].append({'name': 'last-page-navigation', 'passed': True, 'last': last})
                    driver.request('POST', '/frame', {'id': None})
                    driver.screenshot(output / 'last-page.png')
                    if args.probe_print:
                        # Record actual support, never treat an absent command as PDF acceptance.
                        driver.request('POST', '/frame', {'id': frame})
                        try:
                            pdf = driver.request('POST', '/print', {'orientation': 'portrait', 'scale': 1,
                                'background': True, 'page': {'width': 21, 'height': 29.7},
                                'margin': {'top': 0, 'bottom': 0, 'left': 0, 'right': 0}, 'shrinkToFit': False})
                            raw = base64.b64decode(pdf)
                            assert raw.startswith(b'%PDF-'), 'Print response is not PDF'
                            (output / 'webdriver-print-100.pdf').write_bytes(raw)
                            report['printCapability'] = {'supported': True, 'bytes': len(raw),
                                'scope': 'WebDriver-generated PDF; native macOS dialog still unverified'}
                        except DriverError as error:
                            report['printCapability'] = {'supported': False, 'error': error.data}
                        driver.request('POST', '/frame', {'id': None})
                driver.button('Return to editing')
                driver.wait('''return !document.querySelector('iframe[title="Paginated document preview"]')''')
                assert driver.js('return window.vdoc.snapshot().document') == before, 'Preview modified source JSON'
                report['checks'].append({'name': f'preview-{attempt}', 'passed': True, 'status': ready, 'pages': pages, 'rowCounts': counts, 'elapsedSeconds': round(time.monotonic() - preview_started, 3)})
                print(f'Preview {attempt}: 5 pages, 36 rows once, final marker, image, unchanged source', flush=True)
            driver.wait('return !!document.querySelector(".save-status")?.textContent.includes("Saved locally") || '
                        '[...document.querySelectorAll("span")].some(e=>e.textContent.trim()==="Saved locally")')
            driver.request('POST', '/refresh', {})
            restored = driver.wait('return window.vdoc?.snapshot().document || null')
            assert restored == before, 'Reload changed full saved document'
            (output / 'reloaded-document.json').write_text(json.dumps(restored, ensure_ascii=False, indent=2))
            report['checks'].append({'name': 'refresh-full-json', 'passed': True})
            report['state'] = 'passed-in-stated-scope'
    except Exception as error:
        report['state'] = 'blocked' if not driver.session else 'failed'
        report['error'] = str(error)
        if driver.session:
            try:
                driver.request('POST', '/frame', {'id': None})
                driver.screenshot(output / 'failure.png')
            except Exception as screenshot_error:
                report['screenshotError'] = str(screenshot_error)
        raise
    finally:
        if driver.session:
            try:
                driver.request('DELETE', '')
                report['ownSessionClosed'] = True
            except Exception as error:
                report['cleanupError'] = str(error)
        if process:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print('Evidence:', output, flush=True)


if __name__ == '__main__':
    main()
