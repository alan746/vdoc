import AppKit
import ApplicationServices
let expected = ProcessInfo.processInfo.environment["VDOC_QA_WINDOW_TITLE"] ?? ""
guard !expected.isEmpty, let safari = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari").first else { exit(1) }
let requested = safari.activate(options: [.activateIgnoringOtherApps])
RunLoop.current.run(until: Date(timeIntervalSinceNow: 1))
let root = AXUIElementCreateApplication(safari.processIdentifier)
var raw: CFTypeRef?
AXUIElementSetMessagingTimeout(root, 1)
var matches = false
if AXUIElementCopyAttributeValue(root, kAXMainWindowAttribute as CFString, &raw) == .success, let value = raw, CFGetTypeID(value) == AXUIElementGetTypeID() {
 let window = unsafeBitCast(value, to: AXUIElement.self)
 var name: CFTypeRef?
 if AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &name) == .success { matches = (name as? String) == expected }
}
print("{\"activationRequested\":\(requested),\"safariActive\":\(safari.isActive),\"mainMatchesOwnedTitle\":\(matches)}")
