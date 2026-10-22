"""Owned Safari session, real OS keys, DOM evidence only; no candidate screenshot."""
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import time
import urllib.error

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('safari_helpers', ROOT / 'tools/native-qa/safari_acceptance.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
driver = helper.Safari(4181)
report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'scope': 'Native OS title composition in an owned Safari WebDriver session, actual operation entry point. No screenshot or native candidate visibility acceptance.',
          'passed': False}
process = None
previous_source = None
window_id = None
native_keys_sent = False

def front_window():
    script = '''tell application "Safari"
if not (exists front window) then error "No Safari window"
set u to URL of current tab of front window
if not (u starts with "http://127.0.0.1:4187/") then error "Not the VDoc test origin; refuse native input"
set w to id of front window
end tell
tell application "System Events"
if not frontmost of process "Safari" then error "Safari is not foreground"
end tell
return w'''
    return int(subprocess.check_output(['osascript', '-e', script], text=True, timeout=15).strip())

def keys(*codes):
    global native_keys_sent
    if front_window() != window_id:
        raise RuntimeError('Owned test window is no longer foreground')
    script = '''tell application "Safari"
if id of front window is not %d then error "Wrong Safari window"
if not ((URL of current tab of front window) starts with "http://127.0.0.1:4187/") then error "Wrong URL"
end tell
tell application "System Events"
if not frontmost of process "Safari" then error "Wrong foreground process"
%s
end tell''' % (window_id, '\n'.join(f'key code {int(code)}\ndelay 0.08' for code in codes))
    subprocess.run(['osascript', '-e', script], check=True, capture_output=True, timeout=15)
    native_keys_sent = True

try:
    assert not (OUT / 'report.json').exists(), 'Refuse overwrite'
    manifest = json.loads((ROOT / 'tests/fixtures/external-composition-20261012/source-manifest.json').read_text())
    for item in manifest['files']:
        assert hashlib.sha256((ROOT / item['file']).read_bytes()).hexdigest() == item['sha256']
    report['candidate'] = manifest['applicationSha256']
    with socket.socket() as s:
        assert s.connect_ex(('127.0.0.1', 4181)) != 0, 'Refuse occupied driver port'
    with (OUT / 'driver.log').open('w') as log:
        process = subprocess.Popen(['/usr/bin/safaridriver', '--port', '4181'], stdout=log, stderr=log)
        for _ in range(50):
            assert process.poll() is None, 'Own driver exited'
            try:
                driver.request('GET', '/status', session=False)
                break
            except urllib.error.URLError:
                time.sleep(.1)
        session = driver.request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}}, session=False)
        driver.session = session['sessionId']
        report['capabilities'] = session.get('capabilities')
        driver.request('POST', '/url', {'url': 'http://127.0.0.1:4187/'})
        driver.wait('''return !!document.querySelector('input[aria-label="Import file into library"]:not(:disabled)')''')
        upload = driver.find('input[aria-label="Import file into library"]')
        driver.request('POST', '/element/' + upload[helper.ELEMENT] + '/value', {'text': str(ROOT / 'tests/fixtures/safari-preview/source.vdoc.json')})
        driver.wait('return !!window.vdoc')
        driver.click(driver.find('[aria-label="Document title"]'))
        window_id = front_window()
        report['windowId'] = window_id
        previous_source = subprocess.check_output(['/tmp/vdoc-qa-input-source'], text=True).strip()
        report['previousInputSource'] = previous_source
        selected = subprocess.check_output(['/tmp/vdoc-qa-input-source', 'com.apple.inputmethod.SCIM.ITABC'], text=True).strip()
        report['selectedInputSource'] = selected
        assert 'status=0 ' in selected and selected.endswith('com.apple.inputmethod.SCIM.ITABC'), 'Pinyin did not activate'
        before = driver.js('''window.__qaNativeEvents=[];
for(const type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,e=>__qaNativeEvents.push({type:e.type,trusted:e.isTrusted,target:e.target.getAttribute('aria-label'),data:e.data}),true);
return window.vdoc.snapshot();''')
        report['before'] = before
        keys(6, 4, 31, 45, 5)  # z h o n g, physical keycodes
        report['nativeKeysSent'] = True
        events = driver.wait('''return __qaNativeEvents.some(e=>e.type==='compositionstart'&&e.trusted&&e.target==='Document title')&&!__qaNativeEvents.some(e=>e.type==='compositionend') ? __qaNativeEvents : null''', seconds=8)
        report['candidateEvents'] = events
        report['candidateValue'] = driver.js('''return document.querySelector('[aria-label="Document title"]').value''')
        target = next(b for b in before['blocks'] if b['type'] == 'paragraph')
        request = {'id': 'native-title-guard', 'expectedSessionId': before['sessionId'], 'expectedRevision': before['revision'], 'target': {'kind': 'block', 'id': target['id']}, 'operations': [{'type': 'text.style', 'style': {'bold': True}}]}
        report['blockedEdit'] = driver.js('return window.vdoc.execute(arguments[0])', request)
        report['during'] = driver.js('return window.vdoc.snapshot()')
        assert report['blockedEdit']['code'] == 'COMPOSING' and report['during'] == before
        keys(53)  # cancel only within the verified owned window
        report['endedEvents'] = driver.wait('return __qaNativeEvents.some(e=>e.type===\'compositionend\'&&e.trusted) ? __qaNativeEvents : null', seconds=8)
        report['retry'] = driver.js('return window.vdoc.execute(arguments[0])', request)
        assert report['retry']['ok']
        report['undo'] = driver.js('return window.vdoc.undo()')
        assert report['undo']['ok']
        report['after'] = driver.js('return window.vdoc.snapshot()')
        assert report['after']['document'] == before['document']
        report['passed'] = True
except Exception as error:
    report['error'] = repr(error)
finally:
    if previous_source:
        try:
            if window_id is not None and front_window() == window_id:
                if native_keys_sent:
                    keys(53)
                report['restoredInputSource'] = subprocess.check_output(['/tmp/vdoc-qa-input-source', previous_source], text=True, timeout=10).strip()
            else:
                report['restoreSkipped'] = 'Owned window no longer foreground; no global input source change attempted'
        except Exception as error:
            report['restoreError'] = repr(error)
    if driver.session:
        try:
            driver.request('DELETE', '')
            report['sessionClosed'] = True
        except Exception as error:
            report['closeError'] = repr(error)
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k:report[k] for k in ['passed','error','nativeKeysSent','sessionClosed'] if k in report},ensure_ascii=False))
if not report['passed']:
    raise SystemExit(1)
