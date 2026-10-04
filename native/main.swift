import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var logHandle: FileHandle?
    let token = UUID().uuidString + UUID().uuidString
    let port = 43128
    var attempts = 0
    var stopping = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Local Computer", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Local Computer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Local Computer"
        window.minSize = NSSize(width: 840, height: 650)
        window.backgroundColor = NSColor(calibratedWhite: 0.03, alpha: 1)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString("<html style='background:#080808;color:#aaa;font:14px Helvetica;padding:70px'><p>LOCAL / COMPUTER</p><h1 style='color:white;font-weight:400'>Starting your local bots…</h1></html>", baseURL: nil)
        startServer()
    }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Local Computer"
        alert.informativeText = "Five budget bots on this Mac.\nCSV files and spend logs stay local.\nNote uses Gemma through local Ollama."
        alert.runModal()
    }

    func startServer() {
        guard let resources = Bundle.main.resourceURL else { return fail("The app resources are missing.") }
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Local Computer")
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            let logURL = support.appendingPathComponent("server.log")
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
            logHandle = try FileHandle(forWritingTo: logURL)
            let process = Process()
            process.executableURL = resources.appendingPathComponent("node")
            process.arguments = ["--require", resources.appendingPathComponent("local-only.cjs").path, resources.appendingPathComponent("server/server.js").path]
            process.currentDirectoryURL = support
            process.environment = ["PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "NODE_ENV": "production", "HOSTNAME": "127.0.0.1", "PORT": String(port), "NEXT_TELEMETRY_DISABLED": "1", "LOCAL_COMPUTER_TOKEN": token, "LOCAL_COMPUTER_PARENT": String(ProcessInfo.processInfo.processIdentifier)]
            process.standardOutput = logHandle
            process.standardError = logHandle
            server = process
            try process.run()
            pollServer()
        } catch { fail("Could not start the bundled runtime: \(error.localizedDescription)") }
    }

    func pollServer() {
        if stopping { return }
        guard let server = server, server.isRunning else { return fail("The local server could not start. Another app may be using port \(port). Quit it and reopen Local Computer. Details are in ~/Library/Application Support/Local Computer/server.log.") }
        attempts += 1
        if attempts > 100 { return fail("The local server did not start in time. Reopen Local Computer to try again.") }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/computer")!)
        request.setValue(token, forHTTPHeaderField: "X-Local-Computer")
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async {
                if let response = response as? HTTPURLResponse, response.statusCode == 200, response.value(forHTTPHeaderField: "X-Local-Computer") == self.token {
                    self.webView.load(request)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.pollServer() }
                }
            }
        }.resume()
    }

    func fail(_ message: String) {
        if stopping { return }
        stopping = true
        let alert = NSAlert()
        alert.messageText = "Local Computer could not open"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let allowed = url?.absoluteString == "about:blank" || (url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == port)
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        if let server = server, server.isRunning { server.terminate(); server.waitUntilExit() }
        try? logHandle?.close()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
