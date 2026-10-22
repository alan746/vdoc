from helpers import *
command('focus',text='IME test area:');before=state()['snapshot']['document'];keys(6,4,31,45,5)
script='''tell application "Safari"
if id of front window is not 1212 then error "Wrong window"
if not ((URL of current tab of front window) starts with "http://127.0.0.1:4184/") then error "Wrong origin"
set b to bounds of front window
end tell
tell application "System Events"
if not frontmost of process "Safari" then error "Safari is not foreground"
end tell
return b'''
try:
 raw=subprocess.check_output(['osascript','-e',script],text=True).strip();left,top,right,bottom=map(int,raw.split(', '));rect=f'{left+25},{top+115},{right-left-50},{bottom-top-145}'
 subprocess.run(['screencapture','-x','-R',rect,str(out/'candidate-content-only.png')],check=True)
 save('candidate-image-state',state());print('Captured only inset content of verified foreground QA window',flush=True)
finally:
 keys(53);assert state()['snapshot']['document']==before
