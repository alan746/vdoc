import AppKit
import ApplicationServices
import Foundation
let expected = "‎127.0.0.1:4189/vdoc-fixed-pages.pdf"
func get(_ e:AXUIElement,_ key:String)->AnyObject? {AXUIElementSetMessagingTimeout(e,0.4);var v:CFTypeRef?;let code=AXUIElementCopyAttributeValue(e,key as CFString,&v);return code == .success ? v : nil}
guard let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Safari" else {print("{\"error\":\"Safari not foreground\"}");exit(1)}
let root=AXUIElementCreateApplication(app.processIdentifier)
guard let raw=get(root,kAXMainWindowAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID() else {print("{\"error\":\"Main accessibility window unavailable\"}");exit(1)}
let main=unsafeBitCast(raw,to:AXUIElement.self)
guard (get(main,kAXTitleAttribute) as? String)==expected else {print("{\"error\":\"Main window is not uniquely titled VDoc test\"}");exit(1)}
var count=0
func walk(_ e:AXUIElement,_ path:String,_ depth:Int)->[String:Any]{count+=1;var r:[String:Any]=["path":path];if count>500{return r};for key in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXEnabledAttribute]{if let v=get(e,key){if let s=v as? String{r[key]=String(s.prefix(160))}else if let n=v as? NSNumber{r[key]=n}}};let role=r[kAXRoleAttribute] as? String ?? "";if depth>0 && role != "AXWebArea", let children=get(e,kAXChildrenAttribute) as? [AXUIElement]{r["children"]=children.prefix(60).enumerated().map{walk($0.element,path+"."+String($0.offset),depth-1)}};return r}
let args=CommandLine.arguments
if args.count < 5 { print("Missing action, path, role, expected label");exit(1) }
guard let raw=get(root,kAXFocusedWindowAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID() else { print("No focused window");exit(1) }
var target=unsafeBitCast(raw,to:AXUIElement.self)
for part in args[2].split(separator:".").dropFirst(){guard let index=Int(part),let kids=get(target,kAXChildrenAttribute) as? [AXUIElement],index>=0,index<kids.count else { print("Target path absent");exit(1) };target=kids[index]}
let role=get(target,kAXRoleAttribute) as? String ?? "",label=(get(target,kAXTitleAttribute) as? String) ?? (get(target,kAXDescriptionAttribute) as? String) ?? ""
guard role==args[3], label==args[4] else {print("Target role/label changed; action not sent");exit(1)}
var code:AXError
if args[1]=="press" {code=AXUIElementPerformAction(target,kAXPressAction as CFString)}
else if args[1]=="focus" {code=AXUIElementSetAttributeValue(target,kAXFocusedAttribute as CFString,kCFBooleanTrue)}
else if args[1]=="set",args.count==6 {code=AXUIElementSetAttributeValue(target,kAXValueAttribute as CFString,args[5] as CFString)}
else {print("Unknown action");exit(1)}
print("AX action result: \(code.rawValue)");if code != .success {exit(1)}
