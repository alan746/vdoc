import Cocoa
import WebKit

// A development-only host with its own persistent WebKit data store. All
// editing, importing and exporting still run through the unmodified VDoc UI.
// No JavaScript injection, browser-state inspection or Safari control.
final class QAHost: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSMenuDelegate {
    let storeID = UUID(uuidString: "36A96756-6C93-43C3-932C-A4969A453A88")!
    let root = URL(fileURLWithPath: "/Users/ph.qian/Desktop/Vdoc")
    var window: NSWindow!
    var web: WKWebView!
    var downloads: [WKDownload] = []
    var importURL: URL?
    var sequence = 0
    var crashInputMonitor: Any?
    var inputMenu: NSMenu!
    weak var inputContext: NSTextInputContext?

    func record(_ event: String) {
        let url = root.appendingPathComponent("tmp/native-qa/events.log")
        let text = "\(ISO8601DateFormatter().string(from: Date())) pid=\(ProcessInfo.processInfo.processIdentifier) store=\(storeID) \(event)\n"
        if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile(); handle.write(Data(text.utf8)); try? handle.close()
        }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: storeID)
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 100, y: 80, width: 1250, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "VDoc QA — isolated WebKit"
        window.contentView = web
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit VDoc QA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let qaItem = NSMenuItem(); menu.addItem(qaItem)
        let qa = NSMenu(title: "QA"); qaItem.submenu = qa
        for (title, selector, key) in [
            ("Activate VDoc test window", #selector(activateWindow), "a"),
            ("Next import: input and search sample", #selector(chooseA), "1"),
            ("Next import: original print sample", #selector(chooseB), "2"),
            ("Reload VDoc", #selector(reload), "r"),
            ("Arm crash 150 ms after next unmodified key", #selector(armInputCrash), ""),
            ("Crash this QA host (SIGKILL)", #selector(crash), "k")
        ] {
            let item = qa.addItem(withTitle: title, action: selector, keyEquivalent: key)
            item.target = self; item.keyEquivalentModifierMask = [.command, .shift]
        }
        inputMenu = NSMenu(title: "Input source for VDoc"); inputMenu.delegate = self
        let inputItem = qa.addItem(withTitle: "Input source for VDoc", action: nil, keyEquivalent: "")
        inputItem.submenu = inputMenu
        NSApp.mainMenu = menu
        record("launch macOS=\(ProcessInfo.processInfo.operatingSystemVersionString)")
        web.load(URLRequest(url: URL(string: "http://[::1]:5173/")!))
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func activateWindow() {
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        record("activate own window visible=\(window.occlusionState.contains(.visible))")
    }
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === inputMenu else { return }
        menu.removeAllItems(); inputContext = nil
        // Use only this WebKit view's real input context. Never enumerate other
        // applications, inject marked text, or manufacture candidate events.
        guard let context = (window.firstResponder as? NSView)?.inputContext,
              let client = context.client as? NSView,
              client === web || client.isDescendant(of: web) else {
            menu.addItem(withTitle: "Focus VDoc text first", action: nil, keyEquivalent: "").isEnabled = false
            return
        }
        inputContext = context
        for source in context.keyboardInputSources ?? [] {
            let item = menu.addItem(withTitle: NSTextInputContext.localizedName(forInputSource: source) ?? source, action: #selector(selectInputSource(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = source
            item.state = source == context.selectedKeyboardInputSource ? .on : .off
        }
    }
    @objc func selectInputSource(_ item: NSMenuItem) {
        guard let context = inputContext, let source = item.representedObject as? String,
              context.keyboardInputSources?.contains(source) == true,
              let client = context.client as? NSView,
              client === web || client.isDescendant(of: web) else { return }
        context.selectedKeyboardInputSource = source
        record("own text input source selected=\(context.selectedKeyboardInputSource ?? "unavailable")")
    }
    @objc func chooseA() { importURL = root.appendingPathComponent("examples/final-native-acceptance.vdoc.json"); record("next import A") }
    @objc func chooseB() { importURL = root.appendingPathComponent("tests/fixtures/safari-preview/source.vdoc.json"); record("next import B") }
    @objc func reload() { web.reload() }
    @objc func armInputCrash() {
        guard crashInputMonitor == nil else { return }
        record("armed next unmodified key crash delay=150ms")
        crashInputMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, event.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return event }
            if let monitor = self.crashInputMonitor { NSEvent.removeMonitor(monitor) }
            self.crashInputMonitor = nil
            self.record("local key delivered; scheduled host SIGKILL delay=150ms")
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(150)) { self.crash() }
            return event
        }
    }
    @objc func crash() { record("intentional SIGKILL QA host only"); kill(getpid(), SIGKILL) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let selected = importURL else { record("import cancelled: choose a QA fixture first"); completionHandler(nil); return }
        importURL = nil; record("input file \(selected.lastPathComponent)"); completionHandler([selected])
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let local = ["127.0.0.1", "localhost", "[::1]", "::1"].contains(url.host ?? "")
        guard local || ["blob", "about", "data"].contains(url.scheme ?? "") else { decisionHandler(.cancel); return }
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.append(download); download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        sequence += 1
        let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let destination = root.appendingPathComponent("tmp/native-qa/downloads/\(Int(Date().timeIntervalSince1970))-\(sequence)-\(name)")
        record("download destination \(destination.lastPathComponent)"); completionHandler(destination)
    }
    func downloadDidFinish(_ download: WKDownload) { record("download finished"); downloads.removeAll { $0 === download } }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { record("download failed \(error.localizedDescription)"); downloads.removeAll { $0 === download } }
}
let application = NSApplication.shared
let delegate = QAHost()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
