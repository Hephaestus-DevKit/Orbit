import AppKit
import WebKit

// One native window, two independent website data stores. Only the guest receives the
// fixed element-observation script. Its opaque handles expire on use or navigation.
final class Browser: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate,
  WKUIDelegate, NSTextFieldDelegate
{
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1240, height: 780),
    styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
  let guest: WKWebView
  let chat: WKWebView
  let world = WKContentWorld.world(name: "OrbitBrowserControls")
  let address = NSTextField()
  let status = NSTextField(labelWithString: "")
  let body = NSStackView()
  let toggle = NSButton()
  let share = NSButton()
  let draft = NSButton()
  let back = NSButton()
  let forward = NSButton()
  let reload = NSButton()
  var historyObservers: [NSKeyValueObservation] = []
  var workspace: URL?
  var grantedSite: String?
  var revision = 0
  var observedRevision: Int?
  var narrowChat = false
  var chinese = false

  init(script: String) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.addUserScript(
      WKUserScript(
        source: script, injectionTime: .atDocumentStart,
        forMainFrameOnly: true, in: world))
    guest = WKWebView(frame: .zero, configuration: config)
    let trusted = WKWebViewConfiguration()
    trusted.websiteDataStore = .nonPersistent()
    trusted.applicationNameForUserAgent = "OrbitBrowserWorkspace/1"
    chat = WKWebView(frame: .zero, configuration: trusted)
    super.init()
  }

  func t(_ en: String, _ zh: String) -> String { chinese ? zh : en }
  func configure(_ button: NSButton, _ text: String, _ action: Selector, _ name: String? = nil) {
    button.title = text
    button.bezelStyle = .rounded
    button.target = self
    button.action = action
    button.setAccessibilityLabel(name ?? text)
    button.toolTip = name ?? text
  }

  func start(_ url: URL, language: String) {
    workspace = url
    chinese = language.hasPrefix("zh")
    window.title = "Orbit Browser"
    window.minSize = NSSize(width: 520, height: 360)
    window.delegate = self
    guest.navigationDelegate = self
    guest.uiDelegate = self
    chat.navigationDelegate = self
    chat.uiDelegate = self
    configure(back, "‹", #selector(goBack), t("Back", "后退"))
    configure(forward, "›", #selector(goForward), t("Forward", "前进"))
    configure(reload, "↻", #selector(refresh), t("Reload", "刷新"))
    configure(toggle, t("Chat", "对话"), #selector(toggleChat))
    configure(share, "", #selector(toggleAgent))
    configure(draft, "↗", #selector(addToDraft), t("Add page address to chat draft", "追加网页地址到对话草稿"))
    for (button, symbol) in [
      (back, "chevron.left"), (forward, "chevron.right"), (reload, "arrow.clockwise"),
      (draft, "text.badge.plus"),
    ] {
      button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: button.toolTip)
      button.imagePosition = .imageOnly
    }
    address.bezelStyle = .roundedBezel
    address.placeholderString = t("Website or localhost address", "输入网址或 localhost 地址")
    address.setAccessibilityLabel(t("Website address", "网页地址"))
    address.target = self
    address.action = #selector(navigate)
    address.lineBreakMode = .byTruncatingMiddle
    address.setContentHuggingPriority(.defaultLow, for: .horizontal)
    address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let bar = NSStackView(views: [toggle, back, forward, reload, address, draft, share])
    bar.spacing = 5
    bar.edgeInsets = NSEdgeInsets(top: 6, left: 10, bottom: 6, right: 10)
    body.orientation = .horizontal
    body.alignment = .height
    body.distribution = .fillEqually
    body.spacing = 1
    body.addArrangedSubview(chat)
    body.addArrangedSubview(guest)
    status.font = .systemFont(ofSize: 12)
    status.textColor = .secondaryLabelColor
    status.lineBreakMode = .byTruncatingTail
    status.stringValue = t("Enter an address to start browsing.", "在地址栏输入网址，开始浏览。")
    let root = NSStackView(views: [bar, body, status])
    root.orientation = .vertical
    root.spacing = 2
    root.alignment = .leading
    root.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 5, right: 0)
    window.contentView = root
    for v in [bar, body] { v.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true }
    status.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 0)
      .isActive = true
    chat.load(URLRequest(url: url))
    guest.loadHTMLString(
      """
      <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{color-scheme:light dark}body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px -apple-system,system-ui}
      main{text-align:center;max-width:28em;padding:24px}h1{font-size:24px;margin:0}p{color:GrayText;line-height:1.55}
      </style><main><h1>Orbit Browser</h1><p>\(t("Enter a website address above to browse beside your chat.", "在地址栏输入网址，即可边看网页边聊天。"))</p></main>
      """, baseURL: nil)
    historyObservers = [
      guest.observe(\.url, options: [.new]) { [weak self] _, _ in self?.sync() },
      guest.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.sync() },
      guest.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.sync() },
    ]
    sync()
    window.center()
    activate()
    window.makeFirstResponder(address)
  }

  func activate() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
  func sync() {
    if window.firstResponder !== address.currentEditor() || address.currentEditor() == nil {
      address.stringValue = guest.url?.absoluteString ?? ""
    }
    back.isEnabled = guest.canGoBack
    forward.isEnabled = guest.canGoForward
    share.title = grantedSite == nil ? t("Allow agent", "允许 Agent") : t("Take over", "接管")
    share.setAccessibilityLabel(share.title)
    draft.isEnabled = guest.url.map(allowed) == true
    share.isEnabled = guest.url.map(allowed) == true && !guest.isLoading && !guest.isHidden
  }
  @objc func addToDraft() {
    guard let page = guest.url, allowed(page),
      var address = URLComponents(url: page, resolvingAgainstBaseURL: false)
    else { return }
    address.query = nil
    address.fragment = nil
    guard let link = address.url?.absoluteString else { return }
    let script = """
      const input = document.querySelector("#prompt");
      if (!document.querySelector("#connectionState.is-connected") || !input?.dataset.orbitDraftTarget ||
          input.disabled || input.getAttribute("aria-busy") === "true") return false;
      input.value += (input.value ? '\\n\\n' : '') + link;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      return true;
      """
    chat.callAsyncJavaScript(script, arguments: ["link": link], in: nil, in: .page) {
      [weak self] result in
      guard let self else { return }
      if case .success(let value) = result, value as? Bool == true {
        self.narrowChat = true
        self.chat.isHidden = false
        self.layout()
        self.window.makeFirstResponder(self.chat)
      } else {
        self.status.stringValue = self.t("Wait for the chat to connect.", "请等对话连接后重试。")
      }
    }
  }
  @objc func goBack() { guest.goBack() }
  @objc func goForward() { guest.goForward() }
  @objc func refresh() { guest.reload() }
  @objc func focusAddress() {
    if guest.isHidden {
      narrowChat = false
      layout()
    }
    window.makeFirstResponder(address)
    address.selectText(nil)
  }
  @objc func toggleChat() {
    if window.frame.width < 940 { narrowChat.toggle() } else { chat.isHidden.toggle() }
    layout()
  }
  func layout() {
    if window.frame.width < 940 {
      chat.isHidden = !narrowChat
      guest.isHidden = narrowChat
    } else {
      guest.isHidden = false
    }
    if guest.isHidden { revoke() }
    for control in [back, forward, reload, draft, share] { control.isHidden = guest.isHidden }
    address.isHidden = guest.isHidden
    toggle.title = guest.isHidden ? t("Browser", "浏览器") : t("Chat", "对话")
    sync()
  }
  func windowDidResize(_ notification: Notification) {
    if window.frame.width >= 940 { chat.isHidden = false }
    layout()
  }
  func windowWillClose(_ notification: Notification) {
    revoke()
    NSApp.terminate(nil)
  }

  func site(_ url: URL?) -> String? {
    guard let u = url, let scheme = u.scheme?.lowercased(), let host = u.host?.lowercased() else {
      return nil
    }
    return scheme + "://" + host + ":" + String(u.port ?? (scheme == "https" ? 443 : 80))
  }
  func allowed(_ u: URL) -> Bool {
    guard let host = u.host?.lowercased(), !host.isEmpty, u.user == nil, u.password == nil,
      u.fragment?.components(separatedBy: "&").contains(where: {
        $0.lowercased().hasPrefix("token=")
      }) != true
    else { return false }
    let local = ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host)
    if local && u.port == workspace?.port { return false }
    return u.scheme == "https" || (u.scheme == "http" && local)
  }
  @objc func navigate() {
    let raw = address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let local =
      raw.range(
        of: #"^(localhost|127\.0\.0\.1)(:|/|$)"#, options: [.regularExpression, .caseInsensitive])
      != nil
    let value = raw.contains("://") ? raw : (local ? "http://" : "https://") + raw
    guard !raw.isEmpty, !raw.contains(where: { $0.isWhitespace || $0 == "\\" }),
      let url = URL(string: value), allowed(url)
    else {
      status.stringValue = t(
        "Enter an HTTPS website or a localhost development address.", "请输入 HTTPS 网址或本地开发地址。")
      return
    }
    window.makeFirstResponder(guest)
    guest.load(URLRequest(url: url))
  }

  func revoke() {
    revision += 1
    grantedSite = nil
    share.title = t("Allow agent", "允许 Agent")
    status.stringValue = t("You control this page.", "当前由你控制网页。")
  }
  @objc func toggleAgent() {
    if grantedSite != nil {
      revoke()
    } else if !guest.isLoading, !guest.isHidden, let url = guest.url, allowed(url) {
      grantedSite = site(url)
      revision += 1
      status.stringValue =
        t("Agent can inspect and click controls on ", "Agent 可以查看和点击此站点的控件：") + (url.host ?? "")
    }
    sync()
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else {
      decisionHandler(.cancel)
      return
    }
    if webView === chat {
      // Workspace subframes stay subject to its existing CSP/sandbox.
      if action.targetFrame?.isMainFrame == false || site(url) == site(workspace) {
        decisionHandler(.allow)
      } else {
        decisionHandler(.cancel)

      }
      return
    }
    if url.absoluteString == "about:blank" && guest.url == nil {
      decisionHandler(.allow)
      return
    }
    if allowed(url) {
      if action.targetFrame?.isMainFrame != false, site(url) != grantedSite { revoke() }
      decisionHandler(.allow)
    } else {
      decisionHandler(.cancel)
    }
  }
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if webView === guest, navigationAction.navigationType == .linkActivated,
      let url = navigationAction.request.url, allowed(url)
    {
      guest.load(URLRequest(url: url))
    }
    return nil
  }
  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) { decisionHandler(.deny) }
  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
  ) {
    guard window.isVisible, window.attachedSheet == nil else {
      completionHandler(false)
      return
    }
    let alert = NSAlert()
    alert.messageText = webView === chat ? "Orbit" : (frame.request.url?.host ?? "Website")
    alert.informativeText = String(message.prefix(1500))
    alert.addButton(withTitle: t("Continue", "继续"))
    alert.addButton(withTitle: t("Cancel", "取消"))
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if webView === guest {
      revision += 1
      sync()
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === guest {
      if grantedSite != nil && site(guest.url) != grantedSite { revoke() }
      sync()
    }
  }
  func failed(_ webView: WKWebView, _ error: Error) {
    guard webView === guest, (error as NSError).code != NSURLErrorCancelled else { return }
    revoke()
    sync()
    status.stringValue = t(
      "Page could not load. Check the address and try again.", "网页加载失败，请检查地址后重试。")
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { failed(webView, error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(webView, error)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if webView === guest {
      revoke()
      sync()
    }
  }

}
