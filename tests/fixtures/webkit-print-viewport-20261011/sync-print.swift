import AppKit
import WebKit
import Foundation
let args = CommandLine.arguments
guard args.count == 4, Double(args[3]) != nil else { fatalError("HTML, new PDF path and scale required") }
let scale=Double(args[3])!
guard scale > 0 else { fatalError("Positive scale required") }
let input=URL(fileURLWithPath:args[1]), output=URL(fileURLWithPath:args[2])
guard !FileManager.default.fileExists(atPath:output.path) else { fatalError("Refusing existing PDF") }
class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
 var window:NSWindow!,web:WKWebView!,events:[[String:Any]]=[]
 func applicationDidFinishLaunching(_ notification:Notification){
  let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();config.userContentController.add(self,name:"qa")
  web=WKWebView(frame:NSRect(x:0,y:0,width:900,height:1000),configuration:config);web.navigationDelegate=self
  window=NSWindow(contentRect:web.frame,styleMask:[.titled,.closable],backing:.buffered,defer:false);window.title="VDoc isolated print viewport QA";window.contentView=web;window.orderFront(nil)
  web.loadFileURL(input,allowingReadAccessTo:input.deletingLastPathComponent())
 }
 func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){if let data=message.body as? [String:Any]{events.append(data);print(String(data:try! JSONSerialization.data(withJSONObject:data),encoding:.utf8)!);fflush(stdout)}}
 func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){decisionHandler(navigationAction.request.url==input ? .allow : .cancel)}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
  DispatchQueue.main.asyncAfter(deadline:.now()+0.5){
   let info=NSPrintInfo.shared.copy() as! NSPrintInfo;info.paperSize=NSSize(width:210*72/25.4,height:297*72/25.4);info.leftMargin=0;info.rightMargin=0;info.topMargin=0;info.bottomMargin=0;info.scalingFactor=scale;info.jobDisposition = .save
   info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL]=output
   let op=self.web.printOperation(with:info);op.showsPrintPanel=false;op.showsProgressPanel=false
   print("START scale=\(scale) paper=\(info.paperSize) imageable=\(info.imageablePageBounds)");fflush(stdout)
   let ok=op.run()
   DispatchQueue.main.asyncAfter(deadline:.now()+0.5){
    let result:[String:Any]=["success":ok,"fileExists":FileManager.default.fileExists(atPath:output.path),"input":input.path,"output":output.path,"scale":scale,"events":self.events,"paperPoints":[info.paperSize.width,info.paperSize.height],"host":"isolated nonpersistent WKWebView; NSPrintOperation, not Safari"]
    let json=try! JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);print(String(data:json,encoding:.utf8)!);self.window.close();NSApp.terminate(nil)
   }
  }
 }
}
let app=NSApplication.shared;let host=Host();app.delegate=host;app.setActivationPolicy(.accessory)
app.run()
