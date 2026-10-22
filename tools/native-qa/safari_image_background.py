"""Actual Safari visibility and image loading for the production wait helper.

Own two fresh WebDriver tabs and a loopback fixture server. No visibility
property overrides. This is a native helper test, not the full VDoc preview.
The application import intentionally rejects external image URLs.
"""
import base64
import datetime
import hashlib
import json
import socket
import subprocess
import threading
import time
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from safari_acceptance import Safari, FIXTURE

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
    assert len(images) == 1
    prefix, encoded = images[0]['attrs']['src'].split(',', 1)
    assert prefix.startswith('data:image/') and prefix.endswith(';base64')
    image_bytes = base64.b64decode(encoded, validate=True)
    mime = prefix[5:].split(';')[0]
    source = (ROOT / 'lib/editor/preview-images.ts').read_text()
    compile_js = "const fs=require('node:fs'),e=require('esbuild');process.stdout.write(e.transformSync(fs.readFileSync('lib/editor/preview-images.ts','utf8'),{loader:'ts',format:'iife',globalName:'ImageWait'}).code);"
    bundle = subprocess.run(['node', '-e', compile_js], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    (output / 'wait-helper.js').write_text(bundle)
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
            elif self.path in [route + '/probe', route + '/companion']:
                title = 'VDoc image wait QA' if self.path.endswith('/probe') else 'VDoc background companion'
                body = ('<!doctype html><title>' + title + '</title><h1>' + title + '</h1><p>Isolated native helper test; no personal document.</p><p id="status">Waiting to start</p><main></main><pre id="events"></pre>').encode()
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
    driver = Safari(4181)
    process = None
    report = {'at': stamp, 'state': 'started', 'applicationSha256': manifest['applicationSha256'],
              'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
              'imageSha256': hashlib.sha256(image_bytes).hexdigest(), 'checks': [],
              'scope': 'Production image wait helper in owned Safari tabs; real visibility events and delayed image decode. Not full VDoc preview or native printing acceptance.'}
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
            driver.request('POST', '/url', {'url': origin + route + '/probe'})
            document_handle = driver.request('GET', '/window')
            driver.js(bundle + '\nwindow.qaWaitForImages=ImageWait.waitForPreviewImages;')
            driver.js('''window.qaVisibility=[];window.qaOutcome={state:'pending'};
              const record=kind=>{window.qaVisibility.push({kind,hidden:document.hidden,at:performance.now(),outcome:window.qaOutcome});document.querySelector('#events').textContent=JSON.stringify(window.qaVisibility,null,2);};
              document.addEventListener('visibilitychange',()=>record('visibility'));record('start');
              const root=document.querySelector('main'),image=document.createElement('img');
              image.src=arguments[0];root.append(image);document.querySelector('#status').textContent='Waiting for image';
              window.qaAbort=new AbortController();
              window.qaWaitForImages(root,window.qaAbort.signal).then(()=>{window.qaOutcome={state:'resolved',width:image.naturalWidth,height:image.naturalHeight};record('resolved');document.querySelector('#status').textContent='Image loaded successfully';},error=>{window.qaOutcome={state:'rejected',name:error.name,message:error.message};record('rejected');document.querySelector('#status').textContent=error.message;});''', origin + route + '/image')
            assert requested.wait(5), 'Fixture image not requested'
            driver.screenshot(output / 'preparing.png')
            companion = driver.request('POST', '/window/new', {'type': 'tab'})
            report['companionType'] = companion.get('type')
            driver.request('POST', '/window', {'handle': companion['handle']})
            driver.request('POST', '/url', {'url': origin + route + '/companion'})
            driver.screenshot(output / 'companion.png')
            print('Owned Safari companion active; holding image for 17 seconds.', flush=True)
            time.sleep(17)
            release.set()
            time.sleep(1)
            driver.request('POST', '/window', {'handle': document_handle})
            # Context switching can return before Safari dispatches its native
            # visibility event. Observe the event rather than assuming focus.
            driver.wait("return !document.hidden && window.qaVisibility.some(e=>e.kind==='visibility'&&!e.hidden)", seconds=10)
            driver.wait("return window.qaOutcome.state!=='pending'")
            result = driver.js('return {events:window.qaVisibility,outcome:window.qaOutcome}')
            report.update(result)
            intervals = []
            for index, item in enumerate(result['events']):
                if item['kind'] == 'visibility' and item['hidden']:
                    end = next((v for v in result['events'][index + 1:] if v['kind'] == 'visibility' and not v['hidden']), None)
                    if end:
                        intervals.append(end['at'] - item['at'])
            assert intervals and max(intervals) > 15000, ('No genuine hidden interval beyond old timeout', result)
            assert result['outcome']['state'] == 'resolved', result
            assert result['outcome']['width'] > 0 and result['outcome']['height'] > 0
            assert not any(event['kind'] == 'rejected' for event in result['events'])
            driver.screenshot(output / 'ready.png')
            report['checks'].append({'name': 'native-helper-hidden-image-return', 'passed': True,
                                     'hiddenIntervalsMs': intervals, 'defaultBudgetMs': 15000})
            report['state'] = 'passed-in-stated-scope'
            print('Actual Safari hidden interval >15s and production helper image completion passed.', flush=True)
    except Exception as error:
        report['state'] = 'failed' if driver.session else 'blocked'
        report['error'] = str(error)
        if driver.session:
            try:
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
