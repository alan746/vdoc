import subprocess
script='''tell application "Safari"
set w to window id 1296
if (URL of current tab of w) does not start with "http://127.0.0.1:4185/#document=" then error "Owned URL changed"
activate
set miniaturized of w to false
set index of w to 1
delay 1
return id of front window
end tell'''
r=subprocess.run(['osascript','-e',script],capture_output=True,text=True,timeout=15);assert r.returncode==0 and r.stdout.strip()=='1296',(r.stdout,r.stderr);print('Owned QA window 1296 restored',flush=True)
