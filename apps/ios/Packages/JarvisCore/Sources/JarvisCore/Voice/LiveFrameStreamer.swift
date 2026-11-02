import Foundation

/// Posts sampled frames of a live screen share or camera to the backend watch route, so Jarvis keeps receiving the
/// stream and `watch_for` has a real, continuous source.
public struct VisionWatchClient: Sendable {
    public enum Outcome: Equatable, Sendable {
        case accepted
        /// Too soon after the previous frame; try again at the next tick.
        case rateLimited
        /// The session ended or the daily vision budget is spent; stop streaming.
        case stop
    }

    private let client: JarvisClient

    public init(client: JarvisClient) { self.client = client }

    public func post(sessionId: String, source: VoiceScreenSource, jpeg: Data, feedId: String) async throws -> Outcome {
        guard sessionId.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil,
              jpeg.count >= 4, jpeg.count <= 1_000_000,
              jpeg.starts(with: [0xff, 0xd8]), jpeg.suffix(2).elementsEqual([0xff, 0xd9]),
              UUID(uuidString: feedId) != nil else {
            throw JarvisClientError.invalidRequest
        }
        let body = try JSONEncoder().encode(WatchFrameBody(
            sessionId: sessionId, source: source, frame: jpeg.base64EncodedString(), feedId: feedId
        ))
        do {
            _ = try await client.performAuthenticatedRequest(
                method: .post, path: ["vision", "watch"], body: body, idempotent: false
            )
            return .accepted
        } catch JarvisClientError.httpStatus(404) {
            return .stop
        } catch JarvisClientError.rateLimited {
            return .rateLimited
        }
    }

    public func stop(sessionId: String, source: VoiceScreenSource, feedId: String) async {
        guard let body = try? JSONEncoder().encode(WatchStopBody(sessionId: sessionId, source: source, feedId: feedId)) else {
            return
        }
        _ = try? await client.performAuthenticatedRequest(
            method: .delete, path: ["vision", "watch"], body: body, idempotent: false
        )
    }
}

private struct WatchFrameBody: Encodable {
    let sessionId: String
    let source: VoiceScreenSource
    let frame: String
    let feedId: String
}

private struct WatchStopBody: Encodable {
    let sessionId: String
    let source: VoiceScreenSource
    let feedId: String
}

/// Samples frames at a bounded rate for as long as the share lasts.
public struct LiveFrameStreamer: Sendable {
    public static let interval: Duration = .milliseconds(2_600)
    public static let maximumConsecutiveFailures = 3

    public typealias Capture = @Sendable () async -> Data?
    public typealias Post = @Sendable (Data) async throws -> VisionWatchClient.Outcome
    public typealias Sleep = @Sendable (Duration) async throws -> Void

    private let source: VoiceScreenSource
    private let capture: Capture
    private let post: Post
    private let sleep: Sleep

    public init(
        source: VoiceScreenSource,
        capture: @escaping Capture,
        post: @escaping Post,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) }
    ) {
        self.source = source
        self.capture = capture
        self.post = post
        self.sleep = sleep
    }

    /// Runs until cancelled, the backend says stop, or posting fails repeatedly. Returns true when it was stopped
    /// by the backend or by repeated failure rather than by cancellation.
    @discardableResult
    public func run() async -> Bool {
        var failures = 0
        var previous: Data?
        while !Task.isCancelled {
            if let frame = await capture(), source == .camera || frame != previous {
                do {
                    switch try await post(frame) {
                    case .accepted:
                        previous = frame
                        failures = 0
                    case .rateLimited:
                        break
                    case .stop:
                        return true
                    }
                } catch is CancellationError {
                    return false
                } catch {
                    failures += 1
                    if failures >= Self.maximumConsecutiveFailures { return true }
                }
            }
            do { try await sleep(Self.interval) } catch { return false }
        }
        return false
    }
}
