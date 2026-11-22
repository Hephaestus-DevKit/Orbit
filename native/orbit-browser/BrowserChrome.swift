import AppKit
import WebKit

private func adaptive(_ light: UInt32, _ dark: UInt32) -> NSColor {
  NSColor(name: nil) { appearance in
    let rgb = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
    return NSColor(
      srgbRed: CGFloat(rgb >> 16) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
      blue: CGFloat(rgb & 255) / 255, alpha: 1)
  }
}
let browserAccent = adaptive(0x25685C, 0x81CABB)
private let paper = adaptive(0xF6F8F5, 0x1D2524)

// A small compass face for the start view. It scales in points at every display density.
final class BrowserCompass: NSView {
  override var intrinsicContentSize: NSSize { NSSize(width: 96, height: 96) }
  override func draw(_ dirtyRect: NSRect) {
    let center = NSPoint(x: bounds.midX, y: bounds.midY)
    func point(_ radius: CGFloat, _ radians: CGFloat) -> NSPoint {
      NSPoint(x: center.x + radius * cos(radians), y: center.y + radius * sin(radians))
    }
    let face = NSBezierPath(ovalIn: bounds.insetBy(dx: 5, dy: 5))
    browserAccent.withAlphaComponent(0.055).setFill()
    face.fill()
    browserAccent.withAlphaComponent(0.22).setStroke()
    face.lineWidth = 1
    face.stroke()
    let ticks = NSBezierPath()
    for n in 0..<40 {
      let angle = CGFloat(n) * .pi / 20
      ticks.move(to: point(n % 5 == 0 ? 31 : 36, angle))
      ticks.line(to: point(39, angle))
    }
    browserAccent.withAlphaComponent(0.48).setStroke()
    ticks.stroke()
    let angle = CGFloat.pi * 0.32
    for (direction, color) in [
      (angle, browserAccent), (angle + .pi, browserAccent.withAlphaComponent(0.35)),
    ] {
      let needle = NSBezierPath()
      needle.move(to: point(29, direction))
      needle.line(to: point(6, direction + .pi / 2))
      needle.line(to: point(6, direction - .pi / 2))
      needle.close()
      color.setFill()
      needle.fill()
    }
    paper.setFill()
    NSBezierPath(ovalIn: NSRect(x: center.x - 2, y: center.y - 2, width: 4, height: 4)).fill()
  }
}

// Bound the draggable divider without raising the minimum width of a single-pane window.
final class BrowserSplitController: NSSplitViewController {
  override func splitView(
    _ splitView: NSSplitView, constrainSplitPosition proposed: CGFloat,
    ofSubviewAt dividerIndex: Int
  ) -> CGFloat {
    guard splitView.bounds.width >= 940 else { return proposed }
    return min(max(proposed, 340), splitView.bounds.width - 360)
  }
}

extension Browser {
  func glyph(_ name: String, size: CGFloat) -> NSImage? {
    NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: size, weight: .medium))
  }
  func symbol(_ button: NSButton, _ name: String, label: String) {
    button.image = glyph(name, size: 14)
    button.imagePosition = .imageOnly
    button.setAccessibilityLabel(label)
    button.toolTip = label
  }
  private func iconButton(_ button: NSButton, symbol name: String, label: String, action: Selector)
  {
    configure(button, "", action, label)
    symbol(button, name, label: label)
    button.showsBorderOnlyWhileMouseInside = true
    button.bezelStyle = .accessoryBarAction
    button.isBordered = true
    button.widthAnchor.constraint(equalToConstant: 28).isActive = true
    button.heightAnchor.constraint(equalToConstant: 28).isActive = true
  }
  private func pin(_ view: NSView, in container: NSView) {
    container.addSubview(view)
    view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      view.topAnchor.constraint(equalTo: container.topAnchor),
      view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
  }
  private func line() -> NSBox {
    let rule = NSBox()
    rule.boxType = .separator
    rule.heightAnchor.constraint(equalToConstant: 1).isActive = true
    return rule
  }
  func buildChrome() {
    let frame = window.frame
    let chatController = NSViewController()
    chatController.view = chat
    let pageController = NSViewController()
    pageController.view = pageSurface
    chatPane = NSSplitViewItem(viewController: chatController)
    pagePane = NSSplitViewItem(viewController: pageController)
    for item in [chatPane!, pagePane!] {
      item.canCollapse = true
      item.canCollapseFromWindowResize = false
      split.addSplitViewItem(item)
    }
    split.splitView.isVertical = true
    split.splitView.dividerStyle = .thin
    window.contentViewController = split
    window.setFrame(frame, display: false)
    configureTitleControls()

    let navigation = makeNavigation()
    let footer = makeFooter()
    pin(guest, in: stage)
    makeStartView()
    progress.style = .bar
    progress.isIndeterminate = false
    progress.controlSize = .mini
    progress.minValue = 0
    progress.maxValue = 1
    progress.setAccessibilityLabel(t("Page loading", "网页加载进度"))
    stage.addSubview(progress)
    progress.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      progress.topAnchor.constraint(equalTo: stage.topAnchor),
      progress.leadingAnchor.constraint(equalTo: stage.leadingAnchor),
      progress.trailingAnchor.constraint(equalTo: stage.trailingAnchor),
    ])
    let column = NSStackView(views: [navigation, line(), stage, line(), footer])
    column.orientation = .vertical
    column.alignment = .width
    column.spacing = 0
    pin(column, in: pageSurface)
    stage.setContentHuggingPriority(.defaultLow, for: .vertical)
    stage.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
  }
  private func configureTitleControls() {
    configure(toggle, t("Hide chat", "隐藏对话"), #selector(toggleChat))
    toggle.image = glyph("sidebar.leading", size: 12)
    toggle.imagePosition = .imageLeading
    toggle.bezelStyle = .accessoryBarAction
    toggle.controlSize = .small
    mode.segmentCount = 2
    mode.segmentStyle = .rounded
    mode.trackingMode = .selectOne
    mode.controlSize = .small
    mode.setLabel(t("Chat", "对话"), forSegment: 0)
    mode.setLabel(t("Web", "网页"), forSegment: 1)
    mode.setAccessibilityLabel(t("Visible pane", "当前面板"))
    mode.target = self
    mode.action = #selector(selectPane)
    let accessory = NSTitlebarAccessoryViewController()
    accessory.layoutAttribute = .right
    let container = NSView(frame: NSRect(x: 0, y: 0, width: 132, height: 28))
    titleControls.addArrangedSubview(toggle)
    titleControls.addArrangedSubview(mode)
    titleControls.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(titleControls)
    NSLayoutConstraint.activate([
      titleControls.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -8),
      titleControls.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    accessory.view = container
    window.addTitlebarAccessoryViewController(accessory)
  }
  private func makeNavigation() -> NSView {
    iconButton(back, symbol: "chevron.backward", label: t("Back", "后退"), action: #selector(goBack))
    iconButton(
      forward, symbol: "chevron.forward", label: t("Forward", "前进"), action: #selector(goForward))
    iconButton(
      reload, symbol: "arrow.clockwise", label: t("Reload", "刷新"), action: #selector(refresh))
    iconButton(
      draft, symbol: "text.badge.plus", label: t("Add page address to chat draft", "追加网页地址到对话草稿"),
      action: #selector(addToDraft))
    address.isBezeled = false
    address.drawsBackground = false
    address.focusRingType = .none
    address.font = .systemFont(ofSize: 13)
    address.placeholderString = t("Enter a website address", "输入网页地址")
    address.setAccessibilityLabel(t("Website address", "网页地址"))
    address.target = self
    address.action = #selector(navigate)
    address.delegate = self
    address.lineBreakMode = .byTruncatingMiddle
    address.setContentHuggingPriority(.defaultLow, for: .horizontal)
    address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    siteIcon.contentTintColor = .secondaryLabelColor
    siteIcon.setAccessibilityElement(false)
    locationBox.boxType = .custom
    locationBox.cornerRadius = 9
    locationBox.borderWidth = 1
    locationBox.borderColor = .separatorColor
    locationBox.fillColor = .textBackgroundColor
    locationBox.contentViewMargins = .zero
    if let inner = locationBox.contentView {
      for control in [siteIcon, address, reload] as [NSView] {
        inner.addSubview(control)
        control.translatesAutoresizingMaskIntoConstraints = false
        control.centerYAnchor.constraint(equalTo: inner.centerYAnchor).isActive = true
      }
      NSLayoutConstraint.activate([
        siteIcon.leadingAnchor.constraint(equalTo: inner.leadingAnchor, constant: 10),
        siteIcon.widthAnchor.constraint(equalToConstant: 16),
        address.leadingAnchor.constraint(equalTo: siteIcon.trailingAnchor, constant: 7),
        address.trailingAnchor.constraint(equalTo: reload.leadingAnchor, constant: -3),
        reload.trailingAnchor.constraint(equalTo: inner.trailingAnchor, constant: -3),
      ])
    }
    locationBox.heightAnchor.constraint(equalToConstant: 32).isActive = true
    let history = NSStackView(views: [back, forward])
    history.spacing = 0
    let row = NSStackView(views: [history, locationBox, draft])
    row.distribution = .fill
    row.spacing = 8
    row.edgeInsets = NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 12)
    row.heightAnchor.constraint(equalToConstant: 52).isActive = true
    return row
  }
  private func makeFooter() -> NSView {
    configure(share, "", #selector(toggleAgent))
    share.controlSize = .regular
    share.font = .systemFont(ofSize: 12, weight: .medium)
    status.font = .systemFont(ofSize: 12, weight: .medium)
    status.lineBreakMode = .byTruncatingTail
    status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    authorityIcon.setAccessibilityElement(false)
    authorityIcon.widthAnchor.constraint(equalToConstant: 17).isActive = true
    let row = NSStackView(views: [authorityIcon, status, NSView(), share])
    row.distribution = .fill
    row.spacing = 7
    row.edgeInsets = NSEdgeInsets(top: 0, left: 16, bottom: 0, right: 12)
    row.heightAnchor.constraint(equalToConstant: 43).isActive = true
    return row
  }
  private func makeStartView() {
    panel.boxType = .custom
    panel.borderWidth = 0
    panel.fillColor = paper
    panel.contentViewMargins = .zero
    pin(panel, in: stage)
    guard let content = panel.contentView else { return }
    compass.setAccessibilityElement(false)
    headline.font = .systemFont(ofSize: 25, weight: .semibold)
    headline.alignment = .center
    guidance.font = .systemFont(ofSize: 13)
    guidance.textColor = .secondaryLabelColor
    guidance.alignment = .center
    configure(pageAction, "", #selector(activatePageAction))
    pageAction.controlSize = .large
    recoveryMark.image = glyph("exclamationmark.circle", size: 46)
    recoveryMark.contentTintColor = .secondaryLabelColor
    recoveryMark.setAccessibilityElement(false)
    let stack = NSStackView(views: [compass, recoveryMark, headline, guidance, pageAction])
    stack.orientation = .vertical
    stack.spacing = 8
    stack.setCustomSpacing(19, after: compass)
    stack.setCustomSpacing(19, after: recoveryMark)
    stack.setCustomSpacing(19, after: guidance)
    stack.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -32),
      guidance.widthAnchor.constraint(lessThanOrEqualToConstant: 330),
    ])
  }
  func updateStage(empty: Bool, failed: Bool) {
    panel.isHidden = !empty && !failed
    guest.isHidden = !panel.isHidden
    guard !panel.isHidden else { return }
    compass.isHidden = failed
    recoveryMark.isHidden = !failed
    headline.stringValue = failed ? t("Page unavailable", "网页暂时无法打开") : t("Open a website", "打开网页")
    guidance.stringValue =
      failed
      ? t("Check the address or your connection, then try again.", "请检查网址或网络连接，然后重试。")
      : t("Browse alongside your conversation.", "在这里浏览网页，随时把链接带回对话。")
    pageAction.title = failed ? t("Try again", "重新加载") : t("Enter address", "输入网址")
    pageAction.setAccessibilityLabel(pageAction.title)
    pageAction.toolTip = failed ? pageAction.title : t("Focus the address bar (⌘L)", "定位到地址栏（⌘L）")
    pageAction.image = glyph(failed ? "arrow.clockwise" : "magnifyingglass", size: 12)
    pageAction.imagePosition = .imageLeading
  }
  @objc func activatePageAction() {
    if let page = failedPage { openPage(page) } else { focusAddress() }
  }
}

extension Browser: NSMenuItemValidation {
  func installMenus() {
    let menu = NSMenu()
    func submenu(_ title: String) -> NSMenu {
      let item = menu.addItem(withTitle: title, action: nil, keyEquivalent: "")
      let result = NSMenu(title: title)
      item.submenu = result
      return result
    }
    let application = submenu("Orbit Browser")
    application.addItem(
      withTitle: t("Quit Orbit Browser", "退出 Orbit 浏览器"),
      action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let edit = submenu(t("Edit", "编辑"))
    for (title, action, key) in [
      (t("Cut", "剪切"), "cut:", "x"), (t("Copy", "拷贝"), "copy:", "c"),
      (t("Paste", "粘贴"), "paste:", "v"), (t("Select All", "全选"), "selectAll:", "a"),
    ] {
      edit.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
    }
    let view = submenu(t("View", "显示"))
    for (title, action, key) in [
      (t("Open Location", "定位到地址栏"), #selector(focusAddress), "l"),
      (t("Reload or Stop", "重新加载或停止"), #selector(refresh), "r"),
      (t("Back", "后退"), #selector(goBack), "["),
      (t("Forward", "前进"), #selector(goForward), "]"),
    ] {
      view.addItem(withTitle: title, action: action, keyEquivalent: key).target = self
    }
    view.addItem(.separator())
    let panes = view.addItem(
      withTitle: t("Toggle Chat", "切换对话面板"), action: #selector(toggleChat), keyEquivalent: "s")
    panes.keyEquivalentModifierMask = [.command, .option]
    panes.target = self
    view.addItem(
      withTitle: t("Close Window", "关闭窗口"), action: #selector(NSWindow.performClose(_:)),
      keyEquivalent: "w"
    ).target = window
    NSApp.mainMenu = menu
  }
  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    switch menuItem.action {
    case #selector(goBack): return !pagePane.isCollapsed && back.isEnabled
    case #selector(goForward): return !pagePane.isCollapsed && forward.isEnabled
    case #selector(refresh): return !pagePane.isCollapsed && reload.isEnabled
    default: return true
    }
  }
}
