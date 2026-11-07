import Foundation
import JarvisCore
import XCTest

/// Runs the production adapter against URLSession's real AsyncBytes. The other
/// UI fixtures return finished streams and cannot expose transport buffering.
final class URLSessionTransportTests: XCTestCase {
    override func tearDown() {
        StreamTestProtocol.state.reset()
        super.tearDown()
    }

    func testSmallAcceptedFrameArrivesBeforeEOF() async throws {
        let frame = "event: delta\r\ndata: {\"text\":\"Hej æøå 👋\"}\r\n\r\n"
        StreamTestProtocol.state.install { connection in
            connection.respond(frame)
            // Deliberately leave the connection open, below the old 16 KB threshold.
        }
        let session = makeSession()
        defer { session.invalidateAndCancel() }
        let response = try await URLSessionTransport(session: session).stream(request())
        let received = expectation(description: "Small frame delivered while connection stays open")
        let consumer = Task { () throws -> Data in
            var data = Data()
            for try await chunk in response.body {
                data.append(chunk)
                if data.count >= frame.utf8.count {
                    received.fulfill()
                    return data
                }
            }
            return data
        }
        await fulfillment(of: [received], timeout: 3)
        StreamTestProtocol.state.firstConnection()?.finish()
        let data = try await consumer.value
        XCTAssertEqual(data, Data(frame.utf8))
    }

    func testTimeoutAfterAcceptanceReattachesWithoutResending() async throws {
        let user = "event: user\ndata: {\"id\":\"42\",\"sessionId\":\"12\",\"role\":\"dan\",\"text\":\"Prepare the widget\",\"model\":null,\"at\":\"2026-11-07T17:00:00Z\"}\n\n"
        let done = "event: done\ndata: {\"id\":\"43\",\"sessionId\":\"12\",\"role\":\"jarvis\",\"text\":\"Prepared\",\"model\":null,\"at\":\"2026-11-07T17:00:01Z\"}\n\n"
        StreamTestProtocol.state.install { connection in
            if connection.request.httpMethod == "POST" {
                connection.respond(user)
            } else {
                connection.respond(user + done)
                connection.finish()
            }
        }
        let session = makeSession()
        defer { session.invalidateAndCancel() }
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://stream-test.invalid")!),
            transport: URLSessionTransport(session: session),
            tokenStore: StreamTestTokenStore(), accessTokenProvider: StreamTestTokenProvider()
        )
        let chat = JarvisChatClient(client: client)
        let stream = try await chat.sendTurn(sessionId: "12", text: "Prepare the widget")
        let accepted = expectation(description: "Server acceptance reaches Chat before failure")
        let completed = expectation(description: "Recovered turn completes")
        let consumer = Task { () throws -> [ChatEvent] in
            var events: [ChatEvent] = []
            for try await event in stream {
                events.append(event)
                if case .user = event { accepted.fulfill() }
            }
            completed.fulfill()
            return events
        }
        await fulfillment(of: [accepted], timeout: 3)
        StreamTestProtocol.state.firstConnection()?.fail(URLError(.timedOut))
        await fulfillment(of: [completed], timeout: 8)
        let events = try await consumer.value
        XCTAssertEqual(events.filter { if case .user = $0 { true } else { false } }.count, 1)
        XCTAssertEqual(events.filter { if case .done = $0 { true } else { false } }.count, 1)
        XCTAssertTrue(events.contains(.connectionState(.reconnecting)))
        let requests = StreamTestProtocol.state.requests()
        XCTAssertEqual(requests.map(\.httpMethod), ["POST", "GET"])
        XCTAssertEqual(requests.last?.url?.path, "/conversation/sessions/12/turns/42/events")
        XCTAssertEqual(requests.first?.timeoutInterval, 240)
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StreamTestProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func request() -> HTTPRequest {
        HTTPRequest(method: .get, url: URL(string: "https://stream-test.invalid/events")!, timeout: .seconds(5))
    }
}

private final class StreamTestProtocol: URLProtocol, @unchecked Sendable {
    static let state = StreamTestState()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "stream-test.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.state.start(self) }
    override func stopLoading() {}

    func respond(_ text: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        // Split inside multibyte text as a real transport can.
        for byte in text.utf8 { client?.urlProtocol(self, didLoad: Data([byte])) }
    }
    func finish() { client?.urlProtocolDidFinishLoading(self) }
    func fail(_ error: Error) { client?.urlProtocol(self, didFailWithError: error) }
}

private final class StreamTestState: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: ((StreamTestProtocol) -> Void)?
    private var connections: [StreamTestProtocol] = []
    func install(_ handler: @escaping (StreamTestProtocol) -> Void) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
        connections = []
    }
    func start(_ connection: StreamTestProtocol) {
        lock.lock()
        connections.append(connection)
        let callback = handler
        lock.unlock()
        callback?(connection)
    }
    func firstConnection() -> StreamTestProtocol? {
        lock.lock(); defer { lock.unlock() }
        return connections.first
    }
    func requests() -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return connections.map(\.request)
    }
    func reset() {
        lock.lock(); defer { lock.unlock() }
        connections = []
        handler = nil
    }
}

private actor StreamTestTokenStore: TokenStore {
    func read() async throws -> String? { "synthetic-session" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}
private actor StreamTestTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "synthetic-access" }
    func requestSignIn() async {}
}
