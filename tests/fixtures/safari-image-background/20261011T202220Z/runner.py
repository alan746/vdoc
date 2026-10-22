"""Owned Safari tabs, production preview, delayed image from the fixed QA fixture.

No visibility overrides, personal-window enumeration or OS print interaction.
The source copy changes only the fixture image URL to a held loopback response.
"""
import base64
import datetime
import hashlib
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from safari_acceptance import Safari, ELEMENT, FIXTURE, normalized

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'tests/fixtures/preview-image-visibility-20261011/source-manifest.json'


def main():
    manifest = json.loads(MANIFEST.read_text())
    for item in manifest['files']:
        assert hashlib.sha256((ROOT / item['file']).read_bytes()).hexdigest() == item['sha256'], item['file']
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = ROOT / 'tests/fixtures/safari-image-background' / stamp
    output.mkdir(parents=True, exist_ok=False)
    fixture = json.loads(FIXTURE.read_text())
    images = []

    def walk(node):
        if node['type'] == 'image':
            images.append(node)
        for child in node.get('content', []):
            walk(child)

    walk(fixture['content'])
    assert len(images) == 1, 'Use only the known single-image fixture'
    data = images[0]['attrs']['src']
    prefix, encoded = data.split(',', 1)
    assert prefix.startswith('data:image/') and prefix.endswith(';base64')
    image_bytes = base64.b64decode(encoded, validate=True)
    mime = prefix[5:].split(';')[0]
    route = '/' + uuid.uuid4().hex
    release = threading.Event()
    requested = threading.Event()
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append({'path': self.path, 'time': time.monotonic()})
            if self.path == route + '/image':
                requested.set()
                release.wait(55)
                body, content_type = image_bytes, mime
            elif self.path == route + '/companion':
                body = b'<!doctype html><title>VDoc background-image QA</title><h1>VDoc test companion</h1><p>Only the owned document tab is waiting for its test image.</p>'
                content_type = 'text/html; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    images[0]['attrs']['src'] = origin + route + '/image'
    source = output / 'source.vdoc.json'
    source.write_text(json.dumps(fixture, ensure_ascii=False, indent=2))
    driver = Safari(4181)
    process = None
    report = {'at': stamp, 'state': 'started', 'applicationSha256': manifest['applicationSha256'],
              'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'originalFixtureSha256': hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
              'imageSha256': hashlib.sha256(image_bytes).hexdigest(), 'checks': [],
              'scope': 'Production preview and genuine visibility events in owned Safari tabs. Fixed B fixture with identical image bytes served through delayed loopback URL. No native print/PDF acceptance.'}
    try:
        with socket.socket() as sock:
            assert sock.connect_ex(('127.0.0.1', 4181)) != 0, 'Refusing occupied driver port'
        with (output / 'driver.log').open('w') as log:
            process = subprocess.Popen(['/usr/bin/safaridriver', '--port', '4181'], stdout=log, stderr=log)
            for _ in range(50):
                if process.poll() is not None:
                    raise RuntimeError('Owned driver exited')
                try:
                    driver.request('GET', '/status', session=False)
                    break
                except urllib.error.URLError:
                    time.sleep(.1)
            session = driver.request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}}, session=False)
            driver.session = session['sessionId']
            report['capabilities'] = session['capabilities']
            driver.request('POST', '/timeouts', {'implicit': 0, 'pageLoad': 45000, 'script': 30000})
            driver.request('POST', '/url', {'url': 'http://localhost:5173/'})
            driver.wait('''return !!document.querySelector('input[aria-label="Import file into library"]:not(:disabled)')''')
            upload = driver.find('input[aria-label="Import file into library"]')
            driver.request('POST', '/element/' + upload[ELEMENT] + '/value', {'text': str(source)})
            before = driver.wait('return window.vdoc?.snapshot().document || null')
            assert normalized(before) == normalized(fixture['content'])
            assert requested.wait(5), 'Fixture image was not requested'
            document_handle = driver.request('GET', '/window')
            driver.js('''window.qaVisibility=[];
              const observe=()=>window.qaVisibility.push({hidden:document.hidden,at:performance.now(),
                status:document.querySelector('.print-preview-controls [role="status"]')?.textContent || null});
              document.addEventListener('visibilitychange',observe);observe();''')
            driver.button('Print')
            driver.wait('''return document.querySelector('.print-preview-controls [role="status"]')?.textContent==='Preparing pages…' ''')
            driver.screenshot(output / 'preparing.png')
            companion = driver.request('POST', '/window/new', {'type': 'tab'})
            report['companionType'] = companion.get('type')
            driver.request('POST', '/window', {'handle': companion['handle']})
            driver.request('POST', '/url', {'url': origin + route + '/companion'})
            driver.screenshot(output / 'companion.png')
            print('Owned Safari companion active; holding the fixture image for 17 seconds.', flush=True)
            time.sleep(17)
            release.set()
            time.sleep(1)
            driver.request('POST', '/window', {'handle': document_handle})
            visibility = driver.js('return window.qaVisibility')
            report['visibility'] = visibility
            intervals = []
            for index, item in enumerate(visibility):
                if item['hidden']:
                    next_visible = next((v for v in visibility[index + 1:] if not v['hidden']), None)
                    if next_visible:
                        intervals.append(next_visible['at'] - item['at'])
            assert intervals and max(intervals) > 15000, ('No genuine hidden interval beyond old timeout', visibility)
            ready = driver.wait('''const s=document.querySelector('.print-preview-controls [role="status"]')?.textContent;
              const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Print / Save PDF');
              if(s&&!s.includes('Preparing')&&(!b||b.disabled))throw Error(s);
              return b&&!b.disabled?s:null;''', seconds=65)
            frame = driver.find('iframe[title="Paginated document preview"]')
            driver.request('POST', '/frame', {'id': frame})
            pages = driver.js('''return [...document.querySelectorAll('.pagedjs_page')].map(p=>({
              text:p.querySelector('.pagedjs_page_content')?.innerText || '',
              images:[...p.querySelectorAll('img')].map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight}))}));''')
            report['pages'] = pages
            assert len(pages) == 5
            text = '\n'.join(p['text'] for p in pages)
            counts = {f'{n:02}': len(re.findall(r'ROW\s+' + f'{n:02}' + r'\b', text)) for n in range(1, 37)}
            assert all(count == 1 for count in counts.values()), counts
            assert 'FINAL PAGE CHECK' in pages[-1]['text']
            loaded = [i for p in pages for i in p['images']]
            assert loaded and all(i['complete'] and i['width'] > 0 and i['height'] > 0 for i in loaded)
            driver.request('POST', '/frame', {'id': None})
            driver.screenshot(output / 'ready.png')
            driver.button('Return to editing')
            driver.wait('''return !document.querySelector('iframe[title="Paginated document preview"]')''')
            assert driver.js('return window.vdoc.snapshot().document') == before
            report['checks'].append({'name': 'native-hidden-image-return', 'passed': True,
                                     'status': ready, 'hiddenIntervalsMs': intervals, 'rows': counts,
                                     'sourceJSONUnchanged': True, 'printButtonEnabled': True})
            report['state'] = 'passed-in-stated-scope'
            print('Native hidden interval, resumed preview, 5 pages, image and full source passed.', flush=True)
    except Exception as error:
        report['state'] = 'failed' if driver.session else 'blocked'
        report['error'] = str(error)
        if driver.session:
            try:
                driver.request('POST', '/frame', {'id': None})
                driver.screenshot(output / 'failure.png')
            except Exception as screenshot_error:
                report['screenshotError'] = str(screenshot_error)
        raise
    finally:
        release.set()
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
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        report['requests'] = requests
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print('Evidence:', output, flush=True)


if __name__ == '__main__':
    main()
