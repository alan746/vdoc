"""Normal owned Safari window; native physical input with exact window guards."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
origin=json.loads((OUT/'server.json').read_text())['origin']
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'origin':origin,'passed':False,
        'scope':'Normal dedicated Safari QA origin proxying the unchanged production build. Real physical keycodes and trusted composition events; no candidate-window screenshot.'}
window_id=None
previous=None

def apple(script):
    return subprocess.check_output(['osascript','-e',script],text=True,stderr=subprocess.PIPE,timeout=15).strip()

def guard_script():
    return f'''tell application "Safari"
if id of front window is not {window_id} then error "Wrong front window"
if not ((URL of current tab of front window) starts with {json.dumps(origin+'/')}) then error "Wrong test origin"
end tell
tell application "System Events"
if not frontmost of process "Safari" then error "Safari is not foreground"
end tell'''

def keys(*codes):
    apple(guard_script()+'\ntell application "System Events"\n'+'\n'.join(f'key code {int(code)}\ndelay 0.1' for code in codes)+'\nend tell')

def state():
    return json.loads((OUT/'state.json').read_text())

def wait(predicate,seconds=15):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            value=predicate()
            if value:return value
        except (FileNotFoundError,json.JSONDecodeError):pass
        time.sleep(.15)
    raise TimeoutError('Expected owned-page state did not arrive')

def command(action):
    apple(guard_script())
    cid=str(uuid.uuid4());(OUT/'command.json').write_text(json.dumps({'id':cid,'action':action}))
    def completed():
        result=json.loads((OUT/'ack.json').read_text())
        return result if result['id']==cid else None
    result=wait(completed)
    if not result['ok']:raise RuntimeError(result['error'])
    return result['result']

try:
    assert not (OUT/'report.json').exists(),'Refuse overwrite'
    manifest=json.loads((ROOT/'tests/fixtures/external-composition-20261012/source-manifest.json').read_text())
    for item in manifest['files']:
        assert hashlib.sha256((ROOT/item['file']).read_bytes()).hexdigest()==item['sha256']
    report['candidate']=manifest['applicationSha256']
    window_id=int(apple(f'''tell application "Safari"
make new document with properties {{URL:{json.dumps(origin+'/')}}}
set qaWindowId to id of front window
activate
return qaWindowId
end tell'''))
    report['windowId']=window_id
    wait(lambda:state())
    report['bootstrap']=command('bootstrap')
    report['prepare']=command('prepare')
    apple(guard_script())
    previous=subprocess.check_output(['/tmp/vdoc-qa-input-source'],text=True).strip()
    report['previousInputSource']=previous
    selected=subprocess.check_output(['/tmp/vdoc-qa-input-source','com.apple.inputmethod.SCIM.ITABC'],text=True).strip()
    report['selectedInputSource']=selected
    assert 'status=0 ' in selected and selected.endswith('com.apple.inputmethod.SCIM.ITABC')
    keys(6,4,31,45,5)
    report['nativeKeysSent']=True
    def candidate():
        s=state();e=s['events']
        return s if any(v['type']=='compositionstart' and v['trusted'] and v['target']=='Document title' for v in e) and not any(v['type']=='compositionend' for v in e) else None
    report['candidate']=wait(candidate,8)
    attempt=command('attempt');report['attempt']=attempt
    assert all(attempt[name].get('code')=='COMPOSING' for name in ['edit','undo','redo'])
    assert attempt['before']==attempt['after']==report['prepare']['prepared']
    assert attempt['active']=='Document title'
    keys(53)
    report['ended']=wait(lambda:state() if any(e['type']=='compositionend' and e['trusted'] for e in state()['events']) else None,8)
    retry=command('retry-and-restore');report['retry']=retry
    assert retry['applied']['ok'] and retry['undo']['ok'] and retry['undoSeed']['ok']
    assert retry['restored']['document']==retry['original']['document']
    assert retry['after']['document']!=report['prepare']['prepared']['document']
    assert report['ended']['title']==report['prepare']['title']
    report['passed']=True
except Exception as error:
    report['error']=repr(error)
    try:report['lastState']=state()
    except Exception:pass
finally:
    if window_id is not None:
        if previous:
            try:
                apple(guard_script());keys(53)
                report['restoredInputSource']=subprocess.check_output(['/tmp/vdoc-qa-input-source',previous],text=True,timeout=10).strip()
            except Exception as error:report['restoreError']=repr(error)
        try:
            apple(f'''tell application "Safari"
set qaWindow to window id {window_id}
if not ((URL of current tab of qaWindow) starts with {json.dumps(origin+'/')}) then error "Refuse to close changed window"
close qaWindow
end tell''')
            report['windowClosed']=True
        except Exception as error:report['closeError']=repr(error)
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['passed','error','nativeKeysSent','windowClosed','restoreError'] if k in report},ensure_ascii=False))
if not report['passed']:raise SystemExit(1)
