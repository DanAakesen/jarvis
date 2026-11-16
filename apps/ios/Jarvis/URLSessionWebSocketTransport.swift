import Foundation
import JarvisCore

actor URLSessionWebSocketTransport: WebSocketTransport {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var firstMessage: Task<URLSessionWebSocketTask.Message, any Error>?

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// How long the opening handshake may take before the connection is reported as failed instead of waiting for ever.
    static let connectTimeout: Duration = .seconds(15)

    func connect(url: URL, subprotocols: [String]) async throws {
        socket?.cancel(with: .normalClosure, reason: nil)
        let socket = session.webSocketTask(with: url, protocols: subprotocols)
        self.socket = socket
        socket.resume()
        // A pong is only handed over while a receive is outstanding, so reading starts with the handshake. The first
        // message it returns is the first one `receive()` yields.
        let first = Task { try await socket.receive() }
        firstMessage = first
        do {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask {
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                        // The handler can fire again when the socket closes; a second resume traps the app.
                        let once = ResumeOnce()
                        socket.sendPing { error in
                            once.run {
                                if let error {
                                    continuation.resume(throwing: error)
                                } else {
                                    continuation.resume()
                                }
                            }
                        }
                    }
                }
                group.addTask {
                    try await Task.sleep(for: Self.connectTimeout)
                    throw URLError(.timedOut)
                }
                do {
                    try await group.next()
                    group.cancelAll()
                } catch {
                    // Closing the socket also ends the pending ping, so the group can finish.
                    socket.cancel(with: .goingAway, reason: nil)
                    group.cancelAll()
                    throw error
                }
            }
        } catch {
            first.cancel()
            firstMessage = nil
            self.socket = nil
            throw error
        }
    }

    func send(text: String) async throws {
        guard let socket else { throw VoiceProtocolError.invalidState }
        try await socket.send(.string(text))
    }

    func receive() async -> AsyncThrowingStream<String, any Error> {
        guard let socket else {
            return AsyncThrowingStream { $0.finish(throwing: VoiceProtocolError.invalidState) }
        }
        let first = firstMessage
        firstMessage = nil
        return AsyncThrowingStream { continuation in
            let reader = Task {
                do {
                    var pending = first
                    while !Task.isCancelled {
                        let message: URLSessionWebSocketTask.Message
                        if let early = pending {
                            pending = nil
                            message = try await early.value
                        } else {
                            message = try await socket.receive()
                        }
                        switch message {
                        case .string(let text):
                            if case .terminated = continuation.yield(text) { return }
                        case .data:
                            throw VoiceProtocolError.invalidJSON
                        @unknown default:
                            throw VoiceProtocolError.invalidJSON
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in reader.cancel() }
        }
    }

    func close(code: UInt16) async {
        socket?.cancel(
            with: URLSessionWebSocketTask.CloseCode(rawValue: Int(code)) ?? .normalClosure,
            reason: nil
        )
        socket = nil
    }
}
