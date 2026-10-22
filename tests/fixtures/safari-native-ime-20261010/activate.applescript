tell application "Safari"
 if not (exists window id 1212) then error "Owned VDoc test window no longer exists"
 if not ((URL of current tab of window id 1212) starts with "http://127.0.0.1:4184/#document=") then error "Owned VDoc test URL changed"
 set index of window id 1212 to 1
 activate
end tell
