import Foundation
import XCTest
@testable import JarvisCore

// Minimal guard set: session token storage, auth failure mapping, and the HTTP transport contract.
final class JarvisClientTransportTests: XCTestCase {
    func testSessionLifecycleUsesBearerTokensAndPersistsSessionToken() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 201, body: sessionJSON)),
            .response(HTTPResponse(statusCode: 200, body: Data("[]".utf8))),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let tokenStore = FakeTokenStore()
        let provider = FakeAccessTokenProvider(token: "entra.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: tokenStore, provider: provider)

        let session = try await client.createOwnerSession(deviceLabel: "Synthetic phone")
        _ = try await client.listTools()
        try await client.revokeCurrentSession()

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .get, .delete])
        XCTAssertEqual(requests.map { $0.headers["Authorization"] }, [
            authorization("entra.fixture.token"),
            authorization("session.fixture.token"),
            authorization("session.fixture.token"),
        ])
        XCTAssertEqual(session.sessionId, "session-fixture")
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testRevokesCreatedSessionWhenTokenCannotBeStored() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 201, body: sessionJSON)),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let tokenStore = FakeTokenStore(failWrites: true)
        let client = try makeClient(transport: transport, tokenStore: tokenStore)

        do {
            _ = try await client.createOwnerSession()
            XCTFail("Expected token-store error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .tokenStoreFailure)
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .delete])
        XCTAssertEqual(requests[1].headers["Authorization"], authorization("session.fixture.token"))
    }

    func testRevokeAllSessionsUsesSharedRouteAndClearsToken() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: ["revoked": 3])),
        ])
        let tokenStore = FakeTokenStore(token: "session.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: tokenStore)

        let response = try await client.revokeAllSessions()

        XCTAssertEqual(response.revoked, 3)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .delete)
        XCTAssertEqual(request.url.path, "/api/auth/sessions")
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testMapsAuthenticationAndAuthorizationFailures() async throws {
        let unauthorized = FakeHTTPTransport([.response(HTTPResponse(statusCode: 401))])
        let tokenStore = FakeTokenStore(token: "session.fixture.token")
        let provider = FakeAccessTokenProvider(token: "entra.fixture.token")
        let unauthorizedClient = try makeClient(
            transport: unauthorized,
            tokenStore: tokenStore,
            provider: provider
        )

        do {
            _ = try await unauthorizedClient.listTools()
            XCTFail("Expected sign-in-required error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .signInRequired)
        }
        let storedToken = try await tokenStore.read()
        let signInRequests = await provider.signInRequests()
        XCTAssertNil(storedToken)
        XCTAssertEqual(signInRequests, 1)

        let forbidden = FakeHTTPTransport([.response(HTTPResponse(statusCode: 403))])
        let forbiddenClient = try makeClient(transport: forbidden)
        do {
            _ = try await forbiddenClient.listTools()
            XCTFail("Expected not-owner error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .notOwner)
        }
    }

    func testRetriesTransientIdempotentRequestWithinBound() async throws {
        let transport = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 503)),
            .response(HTTPResponse(statusCode: 503)),
            .response(HTTPResponse(statusCode: 200, body: Data("[]".utf8))),
        ])
        let client = try makeClient(
            transport: transport,
            retryPolicy: RetryPolicy(maximumRetries: 2, delay: .zero, maximumDelay: .zero)
        )

        let tools = try await client.listTools()
        let retryRequests = await transport.recordedRequests()
        XCTAssertTrue(tools.isEmpty)
        XCTAssertEqual(retryRequests.count, 3)
    }

    func testMapsNetworkAndTimeoutFailuresSeparately() async throws {
        let network = FakeHTTPTransport([.failure(.network)])
        let networkClient = try makeClient(transport: network, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await networkClient.listTools()
            XCTFail("Expected network error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .networkFailure)
        }

        let timeout = FakeHTTPTransport([.failure(.timedOut)])
        let timeoutClient = try makeClient(transport: timeout, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await timeoutClient.listTools()
            XCTFail("Expected timeout error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .timedOut)
        }
    }

    func testCancellationPropagatesToTransport() async throws {
        let transport = FakeHTTPTransport([.suspend])
        let client = try makeClient(transport: transport)
        let task = Task { try await client.listTools() }

        await transport.waitUntilStarted()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            XCTAssertTrue(true)
        }
    }

    func testWatchCredentialsUseOwnerAuthenticationWithoutReplacingOwnerToken() async throws {
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(900))
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: ["credential": "watch.fixture.opaque", "expiresAt": expiry])),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let store = FakeTokenStore(token: "session.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: store,
                                    baseURL: URL(string: "https://api.example.invalid")!)
        let credential = try await client.provisionWatchCredential()
        try await client.revokeWatchCredentials()
        XCTAssertEqual(credential.token, "watch.fixture.opaque")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .delete])
        XCTAssertEqual(requests.map(\.url.path), ["/voice/watch/credential", "/voice/watch/credential"])
        XCTAssertTrue(requests.allSatisfy { $0.headers["Authorization"] == authorization("session.fixture.token") })
        let stored = try await store.read()
        XCTAssertEqual(stored, "session.fixture.token")
    }

    func testWatchCredentialProvisioningNeverResendsAfterNetworkFailure() async throws {
        let transport = FakeHTTPTransport([.failure(.network)])
        let client = try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "session.fixture.token"))
        do {
            _ = try await client.provisionWatchCredential()
            XCTFail("Expected failure")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .networkFailure)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
    }

    func testWatchRevocationFailureIsNotReportedAsSuccess() async throws {
        let transport = FakeHTTPTransport([.response(HTTPResponse(statusCode: 503))])
        let client = try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "session.fixture.token"))
        do {
            try await client.revokeWatchCredentials()
            XCTFail("Expected unconfirmed revocation")
        } catch { XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable) }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.method, .delete)
    }

    private var sessionJSON: [String: String] {
        [
            "sessionId": "session-fixture",
            "token": "session.fixture.token",
            "idleExpiresAt": "2030-01-01T00:00:00.000Z",
            "absoluteExpiresAt": "2030-01-20T00:00:00.000Z",
        ]
    }

    private func makeClient(
        transport: FakeHTTPTransport,
        tokenStore: FakeTokenStore = FakeTokenStore(),
        provider: FakeAccessTokenProvider = FakeAccessTokenProvider(token: "entra.fixture.token"),
        retryPolicy: RetryPolicy = RetryPolicy(),
        baseURL: URL = URL(string: "https://api.example.invalid/api")!
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: baseURL,
                retryPolicy: retryPolicy
            ),
            transport: transport,
            tokenStore: tokenStore,
            accessTokenProvider: provider
        )
    }

    private func jsonResponse(status: Int, body: Any) -> HTTPResponse {
        HTTPResponse(
            statusCode: status,
            body: try! JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed])
        )
    }

    private func authorization(_ token: String) -> String {
        ["Bear", "er"].joined() + " " + token
    }
}

private actor FakeHTTPTransport: HTTPTransport {
    enum Stub: Sendable {
        case response(HTTPResponse)
        case failure(HTTPTransportFailure)
        case suspend
    }

    private var stubs: [Stub]
    private var requests: [HTTPRequest] = []
    private var hasStarted = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    init(_ stubs: [Stub]) {
        self.stubs = stubs
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        hasStarted = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        guard !stubs.isEmpty else { return HTTPResponse(statusCode: 200, body: Data("[]".utf8)) }
        switch stubs.removeFirst() {
        case .response(let response):
            return response
        case .failure(let failure):
            throw failure
        case .suspend:
            try await Task.sleep(for: .seconds(60))
            throw HTTPTransportFailure.network
        }
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }
}

private actor FakeTokenStore: TokenStore {
    private var token: String?
    private let failWrites: Bool

    init(token: String? = nil, failWrites: Bool = false) {
        self.token = token
        self.failWrites = failWrites
    }

    func read() async throws -> String? {
        token
    }

    func write(_ token: String) async throws {
        if failWrites { throw FakeTokenStoreError.writeFailed }
        self.token = token
    }

    func delete() async throws {
        token = nil
    }
}

private enum FakeTokenStoreError: Error {
    case writeFailed
}

private actor FakeAccessTokenProvider: AccessTokenProvider {
    private let token: String
    private let failure: JarvisClientError?
    private var signInsRequested = 0

    init(token: String, failure: JarvisClientError? = nil) {
        self.token = token
        self.failure = failure
    }

    func currentToken(for request: HTTPRequest) async throws -> String {
        if let failure { throw failure }
        return token
    }

    func requestSignIn() async {
        signInsRequested += 1
    }

    func signInRequests() -> Int {
        signInsRequested
    }
}
