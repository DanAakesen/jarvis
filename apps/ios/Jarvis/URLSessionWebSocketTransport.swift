import Foundation
import JarvisCore

actor URLSessionWebSocketTransport: WebSocketTransport {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?

    init(session: URLSession = .shared) {
        self.session = session
    }

    func connect(url: URL, subprotocols: [String]) async throws {
        socket?.cancel(with: .normalClosure, reason: nil)
        let socket = session.webSocketTask(with: url, protocols: subprotocols)
        self.socket = socket
        socket.resume()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            socket.sendPing { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
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
        return AsyncThrowingStream { continuation in
            let reader = Task {
                do {
                    while !Task.isCancelled {
                        switch try await socket.receive() {
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
