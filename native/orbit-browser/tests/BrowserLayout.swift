import AppKit
import WebKit

// Run against AppKit's actual layout engine including window minimums and field editor.
@main
struct BrowserLayoutTests {
  @MainActor static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let browser = Browser(script: "")
    let workspace = URL(string: "http://127.0.0.1:9/")!
    browser.start(workspace, language: "zh")
    let window = browser.window
    func settle() {
      RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.08))
      window.contentView?.layoutSubtreeIfNeeded()
    }
    func resize(_ width: CGFloat) {
      var frame = window.frame
      frame.size = NSSize(width: width, height: 620)
      window.setFrame(frame, display: true)
      settle()
      precondition(abs(window.frame.width - width) <= 1, "Window failed to reach requested width")
    }
    func checkAddress() {
      precondition(browser.address.frame.width > 150, "Address field collapsed")
      precondition(
        browser.address.frame.maxX <= browser.reload.frame.minX, "Address overlapped reload")
    }

    resize(1240)
    checkAddress()
    precondition(!browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    precondition(!browser.panel.isHidden && !browser.share.isEnabled)
    let divider = browser.split.splitView
    divider.setPosition(430, ofDividerAt: 0)
    settle()
    precondition(abs(browser.chat.frame.width - 430) < 2)
    browser.toggleChat()
    resize(1100)
    precondition(browser.chatPane.isCollapsed, "Resizing reopened the hidden chat")
    browser.toggleChat()

    resize(420)
    checkAddress()
    precondition(browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    browser.grantedSite = "https://example.test:443"
    browser.mode.selectedSegment = 0
    browser.selectPane()
    settle()
    precondition(browser.pagePane.isCollapsed && !browser.chatPane.isCollapsed)
    precondition(browser.grantedSite == nil, "A hidden webpage retained its agent grant")
    browser.focusAddress()
    settle()
    precondition(!browser.pagePane.isCollapsed && browser.address.currentEditor() != nil)

    window.makeFirstResponder(nil)
    browser.address.stringValue = "bad address"
    browser.navigate()
    precondition(browser.notice != nil)
    let attempted = URL(string: "https://example.test/notes")!
    let error = NSError(
      domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost,
      userInfo: [NSURLErrorFailingURLErrorKey: attempted])
    browser.failed(browser.guest, error)
    precondition(
      browser.failedPage == attempted && browser.address.stringValue == attempted.absoluteString)
    precondition(
      !browser.panel.isHidden && browser.pageAction.title == "重新加载" && !browser.share.isEnabled)
    resize(1240)
    precondition(!browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    print("Passed native browser layout, address, keyboard, recovery, and takeover checks.")
  }
}
