import Foundation

public enum FixtureTransportError: Error, Equatable, Sendable {
    case invalidScenario
    case exhausted
    case requestMismatch
    case expectedStream
}

public struct FixtureRequest: Equatable, Sendable {
    public let method: HTTPMethod
    public let path: String
    public let query: [String: String]
}

/// Replays ordered, single-use JSON interactions without making network requests.
public actor FixtureTransport: HTTPTransport {
    private let interactions: [FixtureInteraction]
    private let clock: any ChatClock
    private var index = 0
    private var requests: [FixtureRequest] = []

    public init(scenario: Data, clock: any ChatClock = ContinuousChatClock()) throws {
        guard scenario.count <= 4 * 1024 * 1024,
              let decoded = try? JSONDecoder().decode(FixtureScenario.self, from: scenario),
              decoded.version == 1, !decoded.interactions.isEmpty,
              decoded.interactions.count <= 1_000,
              decoded.interactions.allSatisfy(\.isValid) else {
            throw FixtureTransportError.invalidScenario
        }
        interactions = decoded.interactions
        self.clock = clock
    }

    /// Only method, path and query are retained; headers, body and origin are never logged.
    public func recordedRequests() -> [FixtureRequest] { requests }

    public func remainingInteractions() -> Int { interactions.count - index }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let interaction = try take(request, streaming: false)
        let deadline = await clock.now() + request.timeout
        try await fixtureWait(interaction.delay, deadline: deadline, clock: clock)
        if let failure = interaction.failure { throw failure.error }
        guard let response = interaction.response else { throw FixtureTransportError.expectedStream }
        return HTTPResponse(
            statusCode: response.statusCode,
            headers: response.headers ?? [:],
            body: try response.body.map { try JSONEncoder().encode($0) } ?? Data()
        )
    }

    public func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        let interaction = try take(request, streaming: true)
        let deadline = await clock.now() + request.timeout
        try await fixtureWait(interaction.delay, deadline: deadline, clock: clock)
        if let failure = interaction.failure { throw failure.error }
        let chunks: [FixtureChunk]
        let statusCode: Int
        let headers: [String: String]
        if let stream = interaction.stream {
            chunks = stream.chunks
            statusCode = stream.statusCode
            headers = stream.headers ?? [:]
        } else if let response = interaction.response {
            let body = try response.body.map { try JSONEncoder().encode($0) } ?? Data()
            chunks = body.isEmpty ? [] : [FixtureChunk(text: String(decoding: body, as: UTF8.self), delayMilliseconds: nil)]
            statusCode = response.statusCode
            headers = response.headers ?? [:]
        } else {
            throw FixtureTransportError.invalidScenario
        }
        let playback = FixturePlayback(
            chunks: chunks, drop: interaction.stream?.drop, deadline: deadline, clock: clock
        )
        return HTTPStreamResponse(
            statusCode: statusCode,
            headers: headers,
            body: AsyncThrowingStream(unfolding: { try await playback.next() })
        )
    }

    private func take(_ request: HTTPRequest, streaming: Bool) throws -> FixtureInteraction {
        try Task.checkCancellation()
        guard index < interactions.count else { throw FixtureTransportError.exhausted }
        let interaction = interactions[index]
        let items = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var query: [String: String] = [:]
        for item in items {
            guard let value = item.value, query[item.name] == nil else {
                throw FixtureTransportError.requestMismatch
            }
            query[item.name] = value
        }
        guard request.method.rawValue == interaction.method,
              request.url.path == interaction.path,
              query == interaction.query ?? [:] else {
            throw FixtureTransportError.requestMismatch
        }
        if let expectedBody = interaction.requestBody {
            guard let body = request.body,
                  let decoded = try? JSONDecoder().decode(JSONValue.self, from: body),
                  decoded == expectedBody else {
                throw FixtureTransportError.requestMismatch
            }
        }
        guard streaming || interaction.stream == nil else { throw FixtureTransportError.expectedStream }
        index += 1
        requests.append(FixtureRequest(method: request.method, path: request.url.path, query: query))
        return interaction
    }
}

private struct FixtureScenario: Decodable {
    let version: Int
    let interactions: [FixtureInteraction]
}

private enum FixtureFailure: String, Decodable, Sendable {
    case network
    case timedOut

    var error: HTTPTransportFailure {
        self == .network ? .network : .timedOut
    }
}

private struct FixtureInteraction: Decodable, Sendable {
    let method: String
    let path: String
    let query: [String: String]?
    let requestBody: JSONValue?
    let delayMilliseconds: Int?
    let response: FixtureResponse?
    let stream: FixtureStream?
    let failure: FixtureFailure?

    var delay: Int { delayMilliseconds ?? 0 }

    var isValid: Bool {
        HTTPMethod(rawValue: method) != nil &&
        path.hasPrefix("/") && !path.hasPrefix("//") && path.utf8.count <= 2_048 &&
        !path.contains("?") && !path.contains("#") &&
        !path.split(separator: "/").contains("..") &&
        (query?.count ?? 0) <= 32 &&
        (query ?? [:]).allSatisfy { !$0.key.isEmpty && $0.key.count <= 128 && $0.value.count <= 2_048 } &&
        validDelay(delay) &&
        [response != nil, stream != nil, failure != nil].filter { $0 }.count == 1 &&
        (response?.isValid ?? true) && (stream?.isValid ?? true)
    }
}

private struct FixtureResponse: Decodable, Sendable {
    let statusCode: Int
    let headers: [String: String]?
    let body: JSONValue?

    var isValid: Bool { validResponse(statusCode, headers) }
}

private struct FixtureStream: Decodable, Sendable {
    let statusCode: Int
    let headers: [String: String]?
    let chunks: [FixtureChunk]
    let drop: FixtureFailure?

    var isValid: Bool {
        validResponse(statusCode, headers) && chunks.count <= 10_000 &&
        chunks.allSatisfy { validDelay($0.delayMilliseconds ?? 0) } &&
        chunks.reduce(0) { $0 + $1.text.utf8.count } <= 1024 * 1024
    }
}

private struct FixtureChunk: Decodable, Sendable {
    let text: String
    let delayMilliseconds: Int?
}

private func validDelay(_ value: Int) -> Bool { (0...300_000).contains(value) }

private func validResponse(_ status: Int, _ headers: [String: String]?) -> Bool {
    (100...599).contains(status) && (headers?.count ?? 0) <= 64 &&
    (headers ?? [:]).allSatisfy {
        !$0.key.isEmpty && $0.key.utf8.count <= 128 && $0.value.utf8.count <= 8_192 &&
        !$0.key.contains("\r") && !$0.key.contains("\n") &&
        !$0.value.contains("\r") && !$0.value.contains("\n")
    }
}

private func fixtureWait(_ milliseconds: Int, deadline: Duration, clock: any ChatClock) async throws {
    try Task.checkCancellation()
    let remaining = deadline - (await clock.now())
    guard remaining > .zero else { throw HTTPTransportFailure.timedOut }
    let delay = Duration.milliseconds(milliseconds)
    if delay > .zero { try await clock.sleep(for: min(delay, remaining)) }
    try Task.checkCancellation()
    guard await clock.now() < deadline else { throw HTTPTransportFailure.timedOut }
}

private actor FixturePlayback {
    private let chunks: [FixtureChunk]
    private let drop: FixtureFailure?
    private let deadline: Duration
    private let clock: any ChatClock
    private var index = 0
    private var finished = false

    init(chunks: [FixtureChunk], drop: FixtureFailure?, deadline: Duration, clock: any ChatClock) {
        self.chunks = chunks
        self.drop = drop
        self.deadline = deadline
        self.clock = clock
    }

    func next() async throws -> Data? {
        try Task.checkCancellation()
        guard !finished else { return nil }
        try await fixtureWait(0, deadline: deadline, clock: clock)
        guard index < chunks.count else {
            finished = true
            if let drop { throw drop.error }
            return nil
        }
        let chunk = chunks[index]
        index += 1
        try await fixtureWait(chunk.delayMilliseconds ?? 0, deadline: deadline, clock: clock)
        return Data(chunk.text.utf8)
    }
}
