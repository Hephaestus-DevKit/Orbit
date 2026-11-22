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
