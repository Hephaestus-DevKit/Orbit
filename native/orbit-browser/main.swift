import AppKit
import WebKit

if CommandLine.arguments.dropFirst() == ["--version"] {
  print("Orbit Browser 1")
  exit(0)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
guard
  let script = try? String(
    contentsOf: URL(fileURLWithPath: CommandLine.arguments[0])
      .deletingLastPathComponent().appendingPathComponent("../Resources/Targets.js"),
    encoding: .utf8)
else { exit(1) }
let browser = Browser(script: script)
app.delegate = browser
let menu = NSMenu()
let appItem = menu.addItem(withTitle: "Orbit Browser", action: nil, keyEquivalent: "")
appItem.submenu = NSMenu()
appItem.submenu?.addItem(
  withTitle: "Quit Orbit Browser", action: #selector(NSApplication.terminate(_:)),
  keyEquivalent: "q")
let edit = menu.addItem(withTitle: "Edit", action: nil, keyEquivalent: "")
edit.submenu = NSMenu()
for (title, action, key) in [
  ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"),
  ("Select All", "selectAll:", "a"),
] {
  edit.submenu?.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
}
let navigation = menu.addItem(withTitle: "View", action: nil, keyEquivalent: "")
navigation.submenu = NSMenu()
navigation.submenu?.addItem(
  withTitle: "Location", action: #selector(Browser.focusAddress), keyEquivalent: "l"
).target = browser
navigation.submenu?.addItem(
  withTitle: "Reload", action: #selector(Browser.refresh), keyEquivalent: "r"
).target = browser
navigation.submenu?.addItem(
  withTitle: "Back", action: #selector(Browser.goBack), keyEquivalent: "["
).target = browser
navigation.submenu?.addItem(
  withTitle: "Forward", action: #selector(Browser.goForward), keyEquivalent: "]"
).target = browser
navigation.submenu?.addItem(
  withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"
).target = browser.window
app.mainMenu = menu
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine() {
    guard line.utf8.count < 16384, let raw = line.data(using: .utf8),
      let message = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any]
    else { continue }
    DispatchQueue.main.async { browser.command(message) }
  }
  DispatchQueue.main.async { NSApp.terminate(nil) }
}
app.run()
