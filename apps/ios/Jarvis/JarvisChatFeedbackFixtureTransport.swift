import Foundation
import CoreFoundation
import JarvisCore

/// Controlled, synthetic turn for native regression checks. No external request is made.
actor JarvisChatFeedbackFixtureTransport: HTTPTransport {
    static var isEnabled: Bool {
#if DEBUG && targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("--ui-test-chat-feedback")
#else
        false
#endif
    }

    let base: any HTTPTransport
    private var history: [[String: Any]] = []
    private var turn: AsyncThrowingStream<Data, any Error>.Continuation?
    private var listeners: [UUID: AsyncThrowingStream<Data, any Error>.Continuation] = [:]
    private var activity: [[String: Any]] = []
    private var language = "en"
    private var completionObserver: ChatFixtureCompletionObserver?
    private var acknowledgmentObserver: ChatFixtureCompletionObserver?
    private var progressObserver: ChatFixtureCompletionObserver?

    init(base: any HTTPTransport) { self.base = base }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard Self.isEnabled else { return try await base.send(request) }
        switch request.url.path {
        case "/api/conversation/history": return try json(["messages": history, "nextCursor": NSNull()])
        case "/api/conversation/turns/active": return try json(["turns": []])
        case "/api/conversation/sessions":
            let body = try JSONSerialization.jsonObject(with: request.body!) as! [String: Any]
            language = body["language"] as! String
            return try json(["id": "12", "channel": "chat", "language": language], status: 201)
        case "/api/now": return try json(["running": [], "items": [], "confirmations": [], "awayMode": false, "updatedAt": "2026-11-07T12:00:00Z"])
        case "/api/jobs": return try json(["jobs": []])
        case "/api/conversation/sessions/12/steer":
            guard turn != nil else { return HTTPResponse(statusCode: 409) }
            let body = try JSONSerialization.jsonObject(with: request.body!) as! [String: Any]
            let saved = message(id: "43", role: "dan", text: body["text"] as! String)
            history.append(saved)
            var partial = message(id: "44", role: "jarvis", text: "I’m checking the last result.")
            partial["interrupted"] = true
            history.append(partial)
            turn?.yield(event("interrupted", partial))
            return try json(saved, status: 202)
        default: return try await base.send(request)
        }
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        guard Self.isEnabled else { return try await base.stream(request) }
        if request.url.path == "/api/now/events" {
            let id = UUID()
            let body = AsyncThrowingStream<Data, any Error> { continuation in
                listeners[id] = continuation
                for item in activity { continuation.yield(event("jarvis-activity", item)) }
                continuation.onTermination = { _ in Task { await self.removeListener(id) } }
            }
            return HTTPStreamResponse(statusCode: 200, headers: ["content-type": "text/event-stream"], body: body)
        }
        guard request.url.path == "/api/conversation/sessions/12/turns" else { return try await base.stream(request) }
        registerTestCompletion()
        let requestBody = try JSONSerialization.jsonObject(with: request.body!) as! [String: Any]
        var saved = message(id: "42", role: "dan", text: requestBody["text"] as! String)
        saved["toolCalls"] = [["id": "tool-42", "tool": "repo_read", "outcome": "ok"]]
        history.append(saved)
        let body = AsyncThrowingStream<Data, any Error> { continuation in
            turn = continuation
            continuation.yield(event("user", saved))
        }
        return HTTPStreamResponse(statusCode: 200, headers: ["content-type": "text/event-stream"], body: body)
    }

    private func acknowledgeTurn() {
        guard turn != nil else { return }
        turn?.yield(event("delta", ["text": "I’ll check the synthetic project."]))
        turn?.yield(event("acknowledgment", ["text": "I’ll check the synthetic project."]))
        publishTool(finished: false)
        publishTool(finished: true)
        acknowledgmentObserver = nil
    }

    private func updateProgress() {
        guard turn != nil else { return }
        let text = "I found the project configuration. I’m checking the build setup next."
        turn?.yield(event("delta", ["text": text]))
        turn?.yield(event("commentary", ["text": text]))
        progressObserver = nil
    }

    private func finishTurn() {
        guard turn != nil else { return }
        let saved = message(id: "45", role: "jarvis", text: "The synthetic check is complete.")
        history.append(saved)
        turn?.yield(event("delta", ["text": "The synthetic check is complete."]))
        turn?.yield(event("done", saved))
        turn?.finish()
        turn = nil
        completionObserver = nil
    }

    private func registerTestCompletion() {
        guard Self.isEnabled, completionObserver == nil else { return }
        // The Simulator test explicitly releases the held response after checking
        // the interrupted state. A timer can finish while XCTest is taking snapshots.
        acknowledgmentObserver = ChatFixtureCompletionObserver(name: "com.jarvis.uitests.acknowledge-chat-feedback") { [weak self] in
            Task { await self?.acknowledgeTurn() }
        }
        progressObserver = ChatFixtureCompletionObserver(name: "com.jarvis.uitests.progress-chat-feedback") { [weak self] in
            Task { await self?.updateProgress() }
        }
        completionObserver = ChatFixtureCompletionObserver(name: "com.jarvis.uitests.finish-chat-feedback") { [weak self] in
            Task { await self?.finishTurn() }
        }
    }

    private func publishTool(finished: Bool) {
        var item: [String: Any] = ["type": finished ? "tool-call-finished" : "tool-call-started",
            "activityId": "12345678-1234-4234-8234-123456789abc", "source": "chat", "messageId": "42", "toolName": "repo_read"]
        if finished { item["outcome"] = "ok" }
        activity.append(item)
        for listener in listeners.values { listener.yield(event("jarvis-activity", item)) }
    }

    private func message(id: String, role: String, text: String) -> [String: Any] {
        ["id": id, "sessionId": "12", "channel": "chat", "language": language, "role": role,
         "text": text, "at": "2026-11-07T12:00:\(id)Z", "interrupted": false, "toolCalls": [], "attachments": []]
    }

    private func removeListener(_ id: UUID) { listeners[id] = nil }
    private func json(_ body: [String: Any], status: Int = 200) throws -> HTTPResponse {
        HTTPResponse(statusCode: status, body: try JSONSerialization.data(withJSONObject: body))
    }
    private func event(_ name: String, _ value: [String: Any]) -> Data {
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return Data("event: \(name)\ndata: \(String(decoding: data, as: UTF8.self))\n\n".utf8)
    }
}

/// Core Foundation exposes Darwin notifications to Swift without private C symbols.
private final class ChatFixtureCompletionObserver: Sendable {
    private let name: String
    private let complete: @Sendable () -> Void

    init(name: String, complete: @escaping @Sendable () -> Void) {
        self.name = name
        self.complete = complete
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                Unmanaged<ChatFixtureCompletionObserver>.fromOpaque(observer)
                    .takeUnretainedValue().complete()
            },
            name as CFString, nil, .deliverImmediately
        )
    }

    deinit {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(rawValue: name as CFString), nil
        )
    }
}
