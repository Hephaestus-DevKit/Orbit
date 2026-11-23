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
    guard let visible = window.screen?.visibleFrame else { preconditionFailure("Missing test display") }
    let wideWidth = min(1240, visible.width.rounded(.down))
    let tallHeight = min(700, visible.height.rounded(.down))
    precondition(wideWidth >= 940 && tallHeight >= 620, "Display too small for layout checks: \(visible)")
    func settle() {
      RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.08))
      window.contentView?.layoutSubtreeIfNeeded()
    }
    func resize(_ width: CGFloat, height: CGFloat = 620) {
      let frame = NSRect(x: visible.minX, y: visible.minY, width: width, height: height)
      window.setFrame(frame, display: true)
      settle()
      precondition(abs(window.frame.width - width) <= 1 && abs(window.frame.height - height) <= 1,
        "Expected \(frame.size), got \(window.frame.size) on display \(visible)")
    }
    func checkAddress() {
      precondition(browser.address.frame.width > 150, "Address field collapsed")
      precondition(
        browser.address.frame.maxX <= browser.reload.frame.minX, "Address overlapped reload")
    }

    resize(wideWidth)
    checkAddress()
    precondition(!browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    precondition(!browser.panel.isHidden && !browser.share.isEnabled)
    let divider = browser.split.splitView
    divider.setPosition(430, ofDividerAt: 0)
    settle()
    precondition(abs(browser.chat.frame.width - 430) < 2)
    browser.toggleChat()
    resize(max(940, wideWidth - 140))
    precondition(browser.chatPane.isCollapsed, "Resizing reopened the hidden chat")
    browser.toggleChat()

    resize(420)
    checkAddress()
    precondition(browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    browser.grantedSite = "https://example.test:443"
    browser.observedCount = 1
    browser.sync()
    precondition(browser.share.isEnabled && browser.activity.stringValue.contains("1"))
    browser.lastClickedLabel = String(repeating: "测试网页按钮", count: 20)
    browser.sync()
    settle()
    precondition(browser.activity.stringValue.hasPrefix("已点击「"))
    precondition(browser.activity.toolTip == browser.activity.stringValue && browser.share.title == "收回控制")
    let textBounds = browser.activity.convert(browser.activity.bounds, to: window.contentView)
    let actionBounds = browser.share.convert(browser.share.bounds, to: window.contentView)
    precondition(textBounds.maxX <= actionBounds.minX && actionBounds.maxX <= window.frame.width)
    browser.mode.selectedSegment = 2
    browser.selectPane()
    settle()
    precondition(!browser.split.splitView.isVertical && browser.grantedSite != nil)
    precondition(!browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    precondition(browser.chat.frame.height >= 240 && browser.stage.frame.height >= 150)
    checkAddress()
    resize(420, height: tallHeight)
    let desiredHeight = min(362, divider.bounds.height - 280)
    divider.setPosition(desiredHeight, ofDividerAt: 0)
    settle()
    let chosenHeight = browser.chat.frame.height
    precondition(abs(chosenHeight - desiredHeight) <= 2)
    browser.mode.selectedSegment = 1
    browser.selectPane()
    browser.mode.selectedSegment = 2
    browser.selectPane()
    settle()
    precondition(abs(browser.chat.frame.height - chosenHeight) <= 2, "Lost the chosen split")
    resize(420, height: 600)
    divider.setPosition(295, ofDividerAt: 0)
    settle()
    func checkPageAction() {
      let frame = browser.pageAction.convert(browser.pageAction.bounds, to: browser.stage)
      precondition(browser.stage.visibleRect.contains(frame), "Page action was clipped")
    }
    checkPageAction()
    precondition(browser.compass.isHidden)
    resize(420, height: 599)
    precondition(browser.chatPane.isCollapsed && !browser.mode.isEnabled(forSegment: 2))
    precondition(browser.grantedSite != nil)
    browser.toggleChat()
    settle()
    precondition(!browser.chatPane.isCollapsed && browser.pagePane.isCollapsed)
    resize(420)
    browser.mode.selectedSegment = 0
    browser.selectPane()
    settle()
    precondition(browser.pagePane.isCollapsed && !browser.chatPane.isCollapsed)
    precondition(browser.grantedSite == nil, "A hidden webpage retained its agent grant")
    precondition(browser.activity.isHidden && browser.lastClickedLabel == nil)
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
    browser.mode.selectedSegment = 2
    browser.selectPane()
    resize(420, height: 600)
    checkPageAction()
    browser.focusAddress()
    guard let editor = browser.address.currentEditor() as? NSTextView else {
      preconditionFailure("Address field editor missing")
    }
    let escape = #selector(NSResponder.cancelOperation(_:))
    editor.setMarkedText(
      "拼", selectedRange: NSRange(location: 1, length: 0),
      replacementRange: NSRange(location: NSNotFound, length: 0))
    precondition(!browser.control(browser.address, textView: editor, doCommandBy: escape))
    precondition(editor.hasMarkedText() && browser.address.currentEditor() === editor)
    editor.unmarkText()
    editor.string = "unfinished"
    editor.doCommand(by: escape)
    settle()
    precondition(browser.address.stringValue == attempted.absoluteString)
    precondition(browser.address.currentEditor() == nil && browser.notice == nil)
    precondition(window.firstResponder === browser.pageAction)
    resize(wideWidth)
    precondition(browser.split.splitView.isVertical)
    precondition(!browser.chatPane.isCollapsed && !browser.pagePane.isCollapsed)
    print("Passed native browser layout, address, keyboard, recovery, and takeover checks.")
  }
}
