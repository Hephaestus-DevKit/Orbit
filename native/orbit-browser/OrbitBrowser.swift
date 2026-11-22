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
  let split = BrowserSplitController()
  let pageSurface = NSView()
  let mode = NSSegmentedControl()
  let toggle = NSButton()
  let titleControls = NSStackView()
  let locationBox = NSBox()
  let siteIcon = NSImageView()
  let authorityIcon = NSImageView()
  let stage = NSView()
  let panel = NSBox()
  let compass = BrowserCompass()
  let recoveryMark = NSImageView()
  let headline = NSTextField(labelWithString: "")
  let guidance = NSTextField(wrappingLabelWithString: "")
  let pageAction = NSButton()
  let progress = NSProgressIndicator()
  var lastCompact: Bool?
  var wideChatVisible = true
  var requestedPage: URL?
  var failedPage: URL?
  var notice: String?
  var chatPane: NSSplitViewItem!
  var pagePane: NSSplitViewItem!
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
    window.minSize = NSSize(width: 420, height: 360)
    window.delegate = self
    guest.navigationDelegate = self
    guest.uiDelegate = self
    chat.navigationDelegate = self
    chat.uiDelegate = self
    buildChrome()
    installMenus()
    chat.load(URLRequest(url: url))
    historyObservers = [
      guest.observe(\.url, options: [.new]) { [weak self] _, _ in self?.sync() },
      guest.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.sync() },
      guest.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.sync() },
      guest.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in self?.sync() },
      pagePane.observe(\.isCollapsed, options: [.new]) { [weak self] item, _ in
        guard let self else { return }
        if item.isCollapsed && self.grantedSite != nil { self.revoke() }
        self.sync()
      },
      guest.observe(\.isLoading, options: [.new]) { [weak self] _, _ in self?.sync() },
    ]
    layout()
    split.view.layoutSubtreeIfNeeded()
    split.splitView.setPosition(round(window.frame.width * 0.40), ofDividerAt: 0)
    window.center()
    activate()
    focusAddress()
  }

  func activate() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
  func sync() {
    let reading = guest.url.flatMap { allowed($0) ? $0 : nil }
    let showing = failedPage ?? (guest.isLoading ? requestedPage : nil) ?? reading
    let editing = address.currentEditor() != nil
    if !editing { address.stringValue = showing?.absoluteString ?? "" }
    back.isEnabled = guest.canGoBack
    forward.isEnabled = guest.canGoForward
    reload.isEnabled = showing != nil
    let loading = guest.isLoading && failedPage == nil
    let reloadLabel = loading ? t("Stop loading", "停止加载") : t("Reload", "刷新")
    symbol(reload, loading ? "xmark" : "arrow.clockwise", label: reloadLabel)
    siteIcon.image = glyph(showing == nil ? "globe" : "network", size: 13)
    progress.doubleValue = guest.estimatedProgress
    progress.isHidden = !loading
    let available = reading != nil && !loading && failedPage == nil && !pagePane.isCollapsed
    draft.isEnabled = available
    share.isEnabled = available
    let shared = grantedSite != nil
    share.title = shared ? t("Take over", "接管") : t("Allow agent", "允许 Agent")
    share.setAccessibilityLabel(share.title)
    share.toolTip =
      shared
      ? t("Return control to you", "收回此网页的控制权")
      : t("Let this chat inspect and click controls on this site", "允许当前对话查看和点击此站点的控件")
    share.bezelColor = shared ? browserAccent : nil
    authorityIcon.image = glyph(shared ? "cursorarrow.rays" : "hand.raised", size: 14)
    authorityIcon.contentTintColor = shared ? browserAccent : .secondaryLabelColor
    let ownership =
      shared
      ? t("Agent can click · ", "Agent 可操作 · ") + (reading?.host ?? "")
      : t("You control this page", "由你控制网页")
    status.stringValue = notice ?? ownership
    status.textColor = notice != nil ? .systemRed : (shared ? browserAccent : .secondaryLabelColor)
    status.toolTip = status.stringValue
    updateStage(empty: reading == nil && !loading, failed: failedPage != nil)
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
        self.wideChatVisible = true
        self.layout()
        self.window.makeFirstResponder(self.chat)
      } else {
        self.notice = self.t("Wait for the chat to connect.", "请等对话连接后重试。")
        self.sync()
      }
    }
  }
  @objc func goBack() { if !pagePane.isCollapsed { guest.goBack() } }
  @objc func goForward() { if !pagePane.isCollapsed { guest.goForward() } }
  @objc func refresh() {
    if pagePane.isCollapsed { return }
    if guest.isLoading {
      guest.stopLoading()
    } else if let page = failedPage {
      openPage(page)
    } else {
      guest.reload()
    }
  }
  @objc func focusAddress() {
    narrowChat = false
    layout()
    window.makeFirstResponder(address)
    address.selectText(nil)
    locationBox.borderColor = browserAccent
  }
  func controlTextDidChange(_ notification: Notification) {
    if notice != nil {
      notice = nil
      sync()
    }
  }
  func controlTextDidBeginEditing(_ notification: Notification) {
    locationBox.borderColor = browserAccent
  }
  func controlTextDidEndEditing(_ notification: Notification) {
    locationBox.borderColor = .separatorColor
  }
  @objc func toggleChat() {
    if compact { narrowChat.toggle() } else { wideChatVisible.toggle() }
    layout()
  }
  @objc func selectPane() {
    narrowChat = mode.selectedSegment == 0
    layout()
    window.makeFirstResponder(narrowChat ? chat : guest)
  }
  var compact: Bool { window.frame.width < 940 }
  func layout() {
    guard let pagePane, let chatPane else { return }
    lastCompact = compact
    let showChat = compact ? narrowChat : wideChatVisible
    let showPage = !compact || !narrowChat
    if showChat && chatPane.isCollapsed { chatPane.isCollapsed = false }
    if showPage && pagePane.isCollapsed { pagePane.isCollapsed = false }
    if !showChat && !chatPane.isCollapsed { chatPane.isCollapsed = true }
    if !showPage && !pagePane.isCollapsed { pagePane.isCollapsed = true }
    toggle.isHidden = compact
    mode.isHidden = !compact
    mode.selectedSegment = narrowChat ? 0 : 1
    let name = wideChatVisible ? t("Hide chat", "隐藏对话") : t("Show chat", "显示对话")
    toggle.title = name
    toggle.setAccessibilityLabel(name)
    toggle.toolTip = name
    sync()
  }
  func windowDidResize(_ notification: Notification) { if compact != lastCompact { layout() } }
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
      notice = t("Use an HTTPS or localhost address.", "请输入 HTTPS 网址或 localhost 地址。")
      sync()
      return
    }
    window.makeFirstResponder(guest)
    openPage(url)
  }
  func openPage(_ url: URL) {
    notice = nil
    failedPage = nil
    requestedPage = url
    if address.currentEditor() != nil { window.makeFirstResponder(nil) }
    address.stringValue = url.absoluteString
    guest.load(URLRequest(url: url))
  }

  func revoke() {
    revision += 1
    grantedSite = nil
    observedRevision = nil
    notice = nil
  }
  @objc func toggleAgent() {
    if grantedSite != nil {
      revoke()
    } else if !guest.isLoading, !pagePane.isCollapsed, failedPage == nil, let url = guest.url,
      allowed(url)
    {
      grantedSite = site(url)
      revision += 1
      notice = nil
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
      if action.targetFrame?.isMainFrame == true {
        requestedPage = url
        if grantedSite != nil && site(url) != grantedSite { revoke() }
      }
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
      failedPage = nil
      notice = nil
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
    let failing = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL
    failedPage = [failing, requestedPage, guest.url].compactMap { $0 }.first(where: allowed)
    sync()
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
      failedPage = guest.url ?? requestedPage
      sync()
    }
  }
}
