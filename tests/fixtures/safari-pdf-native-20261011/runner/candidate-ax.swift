import AppKit
import ApplicationServices
import Foundation
let expected = "VDoc isolated native print 4188"
func get(_ e:AXUIElement,_ key:String)->AnyObject? {AXUIElementSetMessagingTimeout(e,0.4);var v:CFTypeRef?;let code=AXUIElementCopyAttributeValue(e,key as CFString,&v);return code == .success ? v : nil}
guard let app=NSWorkspace.shared.frontmostApplication,app.bundleIdentifier=="com.apple.Safari" else {print("{\"error\":\"Safari not foreground\"}");exit(1)}
let root=AXUIElementCreateApplication(app.processIdentifier)
guard let raw=get(root,kAXMainWindowAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID() else {print("{\"error\":\"Main accessibility window unavailable\"}");exit(1)}
let main=unsafeBitCast(raw,to:AXUIElement.self)
guard (get(main,kAXTitleAttribute) as? String)==expected else {print("{\"error\":\"Main window is not uniquely titled VDoc test\"}");exit(1)}
var count=0
func walk(_ e:AXUIElement,_ path:String,_ depth:Int)->[String:Any]{count+=1;var r:[String:Any]=["path":path];if count>500{return r};for key in [kAXRoleAttribute,kAXTitleAttribute,kAXDescriptionAttribute,kAXValueAttribute,kAXEnabledAttribute]{if let v=get(e,key){if let s=v as? String{r[key]=String(s.prefix(160))}else if let n=v as? NSNumber{r[key]=n}}};let role=r[kAXRoleAttribute] as? String ?? "";if depth>0 && !["AXWebArea","AXBrowser","AXOutline","AXTable"].contains(role), let children=get(e,kAXChildrenAttribute) as? [AXUIElement]{r["children"]=children.prefix(60).enumerated().map{walk($0.element,path+"."+String($0.offset),depth-1)}};return r}
var result:[String:Any]=["testWindow":expected]
if let ime=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.inputmethod.SCIM").first {
 let ir=AXUIElementCreateApplication(ime.processIdentifier)
 result["inputMethodFound"]=true
 for key in [kAXWindowsAttribute,kAXChildrenAttribute,kAXFocusedWindowAttribute,kAXMainWindowAttribute,kAXFocusedUIElementAttribute] {
  if let raw=get(ir,key) {
   if CFGetTypeID(raw)==AXUIElementGetTypeID() {result[key]=walk(unsafeBitCast(raw,to:AXUIElement.self),key,6)}
   else if let nodes=raw as? [AXUIElement]{result[key]=nodes.prefix(3).enumerated().map{walk($0.element,key+String($0.offset),6)}}
  }
 }
} else {result["inputMethodFound"]=false}
let data=try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);print(String(data:data,encoding:.utf8)!)
