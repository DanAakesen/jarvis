import Foundation
import JarvisCore

/// Synthetic runtime playback used only by the existing explicit screenshot-fixture client.
actor JarvisRuntimeTestFixtureTransport: HTTPTransport {
    private let base: any HTTPTransport
    private var created = false
    private var sent = false

    init(base: any HTTPTransport) { self.base = base }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let path = request.url.path
        if request.method == .get && path == "/api/conversation/runtime-tests" {
            return try json(200, ["current": ["available": true],
                                  "copilot": ["available": false, "reason": "copilot_not_configured"]])
        }
        if request.method == .post && path == "/api/conversation/sessions",
           let body = request.body,
           let value = try JSONSerialization.jsonObject(with: body) as? [String: String],
           let runtime = value["runtimeTest"] {
            guard runtime == "current", !created else { throw FixtureTransportError.requestMismatch }
            created = true
            return try json(201, ["id": "99", "channel": "chat", "language": value["language"] ?? "en", "runtimeTest": runtime])
        }
        if request.method == .get && path == "/api/conversation/history",
           URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?.contains(
               where: { $0.name == "sessionId" && $0.value == "99" }
           ) == true {
            guard created else { throw FixtureTransportError.requestMismatch }
            return try json(200, ["messages": sent ? [historyMessage("990", role: "dan", text: "Synthetic test message"),
                                                      historyMessage("991", role: "jarvis", text: "Synthetic isolated runtime reply")] : [],
                                  "nextCursor": NSNull()])
        }
        return try await base.send(request)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        guard request.method == .post && request.url.path == "/api/conversation/sessions/99/turns" else {
            return try await base.stream(request)
        }
        guard created, !sent else { throw FixtureTransportError.requestMismatch }
        sent = true
        let text = try JSONSerialization.jsonObject(with: request.body ?? Data()) as? [String: String]
        let user = try event("user", message("990", role: "dan", text: text?["text"] ?? "Synthetic test message"))
        let done = try event("done", message("991", role: "jarvis", text: "Synthetic isolated runtime reply"))
        return HTTPStreamResponse(statusCode: 200, headers: ["content-type": "text/event-stream"], body: AsyncThrowingStream {
            $0.yield(Data((user + done).utf8))
            $0.finish()
        })
    }

    private func message(_ id: String, role: String, text: String) -> [String: Any] {
        ["id": id, "sessionId": "99", "role": role, "text": text, "at": "2026-11-06T07:00:00Z"]
    }

    private func historyMessage(_ id: String, role: String, text: String) -> [String: Any] {
        message(id, role: role, text: text).merging([
            "channel": "chat", "language": "en", "interrupted": false, "toolCalls": [], "attachments": [],
        ]) { _, value in value }
    }

    private func json(_ status: Int, _ body: [String: Any]) throws -> HTTPResponse {
        HTTPResponse(statusCode: status, headers: ["content-type": "application/json"], body: try JSONSerialization.data(withJSONObject: body))
    }

    private func event(_ name: String, _ body: [String: Any]) throws -> String {
        "event: \(name)\ndata: \(String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self))\n\n"
    }
}
