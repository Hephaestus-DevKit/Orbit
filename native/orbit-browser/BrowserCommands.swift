import AppKit
import WebKit

extension Browser {
  func reply(_ id: Int, _ data: Any? = nil, error: String? = nil) {
    let result: [String: Any] =
      error.map { ["id": id, "error": $0] } ?? ["id": id, "data": data ?? NSNull()]
    guard let encoded = try? JSONSerialization.data(withJSONObject: result), encoded.count <= 65536
    else { return }
    FileHandle.standardOutput.write(encoded + Data([10]))
  }
  func command(_ message: [String: Any]) {
    guard let id = message["id"] as? Int, let action = message["action"] as? String else { return }
    if workspace == nil {
      guard action == "start", let raw = message["workspace"] as? String,
        let url = URL(string: raw),
        url.scheme == "http", url.host == "127.0.0.1", url.port != nil, url.path == "/",
        url.query == nil, url.user == nil, url.password == nil,
        url.fragment?.range(of: #"^token=[a-zA-Z0-9_-]{32,128}$"#, options: .regularExpression)
          != nil
      else {
        reply(id, error: "Invalid workspace")
        return
      }
      start(url, language: message["language"] as? String ?? "en")
      if let address = message["address"] as? String, let page = URL(string: address), allowed(page)
      {
        guest.load(URLRequest(url: page))
      }
      reply(id, true)
      return
    }
    if action == "focus" {
      activate()
      narrowChat = false
      layout()
      if let raw = message["address"] as? String, let page = URL(string: raw), allowed(page) {
        guest.load(URLRequest(url: page))
      }
      reply(id, true)
      return
    }
    if action == "revoke" {
      revoke()
      sync()
      reply(id, true)
      return
    }
    guard let grant = grantedSite, grant == site(guest.url), !guest.isHidden, window.isVisible,
      !window.isMiniaturized, !guest.isLoading
    else {
      reply(id, error: "Open a page in Orbit Browser and choose Allow agent.")
      return
    }
    let current = revision
    let complete: (Result<Any, Error>) -> Void = { [weak self] result in
      guard let self else { return }
      guard current == self.revision, self.grantedSite == grant else {
        self.reply(id, error: "The page or control permission changed. Observe again.")
        return
      }
      switch result {
      case .success(let output):
        if action == "click" && (output as? Bool) != true {
          self.reply(id, error: "Control changed. Observe again.")
        } else {
          if action == "observe" { self.observedRevision = current }
          self.reply(id, output)
        }
      case .failure: self.reply(id, error: "Page changed. Observe again.")
      }
    }
    if action == "observe" {
      observedRevision = nil
      guest.callAsyncJavaScript(
        "return globalThis.orbitObserve()", arguments: [:], in: nil, in: world,
        completionHandler: complete)
    } else if action == "click", let target = message["target"] as? String,
      UUID(uuidString: target) != nil, observedRevision == current
    {
      observedRevision = nil
      guest.callAsyncJavaScript(
        "return globalThis.orbitClick(target)", arguments: ["target": target], in: nil, in: world,
        completionHandler: complete)
    } else {
      reply(id, error: "Invalid browser command")
    }
  }
}
