import Foundation
import XCTest
@testable import JarvisCore

final class JarvisCoreTests: XCTestCase {
    func testPackageModuleIsAvailable() {
        XCTAssertEqual(String(describing: JarvisCore.self), "JarvisCore")
    }

    func testSidebarItemsAreOrderedFromLowestToHighest() {
        XCTAssertEqual(
            JarvisDestination.sidebarItems,
            [.proactive, .status, .usage, .banking, .softwareFactory, .health, .workspaces, .notes, .chat]
        )
    }

    func testNavigationPushesPlaceholderAndBackReturnsToChat() {
        var navigation = JarvisNavigationState()

        navigation.navigate(to: .health)
        XCTAssertEqual(navigation.currentDestination, .health)
        XCTAssertEqual(navigation.path, [.health])

        navigation.goBack()
        XCTAssertEqual(navigation.currentDestination, .chat)
        XCTAssertTrue(navigation.path.isEmpty)
    }

    func testNavigationReusesExistingDestinationAndChatReturnsToRoot() {
        var navigation = JarvisNavigationState()
        navigation.navigate(to: .notes)
        navigation.navigate(to: .settings)
        navigation.navigate(to: .notes)

        XCTAssertEqual(navigation.path, [.notes])
        navigation.navigate(to: .chat)
        XCTAssertTrue(navigation.path.isEmpty)
        XCTAssertEqual(navigation.currentDestination, .chat)
    }

    func testVoiceIsANavigableDestinationAndBankingIsDisabled() {
        var navigation = JarvisNavigationState()
        navigation.navigate(to: .voice)
        XCTAssertEqual(navigation.currentDestination, .voice)

        navigation.navigate(to: .banking)
        XCTAssertEqual(navigation.currentDestination, .voice)
        XCTAssertEqual(navigation.path, [.voice])
    }

    func testEndingVoiceReturnsToChatAndKeepsSidebarNavigationUsable() {
        for minimized in [false, true] {
            var navigation = JarvisNavigationState()
            navigation.navigate(to: .notes)
            navigation.navigate(to: .voice)
            if minimized { navigation.navigate(to: .settings) }
            navigation.openSidebar()

            navigation.voiceSessionStateChanged(.ended)

            XCTAssertEqual(navigation.currentDestination, .chat)
            XCTAssertTrue(navigation.path.isEmpty)
            XCTAssertFalse(navigation.isSidebarOpen)

            navigation.openSidebar()
            XCTAssertTrue(navigation.isSidebarOpen)
            navigation.navigate(to: .notes)
            XCTAssertEqual(navigation.path, [.notes])
            XCTAssertFalse(navigation.isSidebarOpen)
        }
    }

    func testOtherVoiceStatesDoNotChangeNavigation() {
        var navigation = JarvisNavigationState()
        navigation.navigate(to: .voice)
        navigation.openSidebar()
        let original = navigation

        for state: VoiceSessionState in [.idle, .connecting, .ready, .listening, .speaking, .reconnecting(attempt: 1), .failed] {
            navigation.voiceSessionStateChanged(state)
            XCTAssertEqual(navigation, original)
        }
    }

    func testNavigationPathRejectsRootDisabledAndDuplicateDestinations() {
        var navigation = JarvisNavigationState()
        navigation.setPath([.chat, .notes, .banking, .notes, .settings])

        XCTAssertEqual(navigation.path, [.notes, .settings])
        XCTAssertEqual(navigation.currentDestination, .settings)
    }

    func testSidebarCanBeOpenedAndClosed() {
        var navigation = JarvisNavigationState()
        navigation.openSidebar()
        XCTAssertTrue(navigation.isSidebarOpen)

        navigation.navigate(to: .status)
        XCTAssertFalse(navigation.isSidebarOpen)

        navigation.setSidebarOpen(true)
        navigation.closeSidebar()
        XCTAssertFalse(navigation.isSidebarOpen)
    }

    func testStreamingTransportDefaultKeepsExistingFakesCompatible() async throws {
        let body = Data("synthetic stream".utf8)
        let transport = FakeHTTPTransport([.response(HTTPResponse(statusCode: 200, body: body))])
        let response = try await transport.stream(HTTPRequest(
            method: .get,
            url: URL(string: "https://api.example.invalid/events")!,
            timeout: .seconds(1)
        ))
        var received = Data()
        for try await chunk in response.body {
            received.append(chunk)
        }

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(received, body)
    }

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
        XCTAssertEqual(requests.map(\.timeout), [.seconds(30), .seconds(30), .seconds(30)])
        XCTAssertEqual(requests[0].url.path, "/api/auth/session")
        XCTAssertEqual(requests[1].url.path, "/api/tools")
        XCTAssertEqual(requests[2].url.path, "/api/auth/session")
        XCTAssertEqual(session.sessionId, "session-fixture")
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testCreateSessionOmitsBodyWhenDeviceLabelIsAbsent() async throws {
        let transport = FakeHTTPTransport([.response(jsonResponse(status: 201, body: sessionJSON))])
        let client = try makeClient(transport: transport)

        _ = try await client.createOwnerSession()

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertNil(request.body)
        XCTAssertEqual(request.headers["Authorization"], authorization("entra.fixture.token"))
    }

    func testTypedAccessTokenProviderNetworkFailureRemainsOffline() async throws {
        let provider = FakeAccessTokenProvider(
            token: "entra.fixture.token",
            failure: .networkFailure
        )
        let client = try makeClient(transport: FakeHTTPTransport([]), provider: provider)

        do {
            _ = try await client.createOwnerSession()
            XCTFail("Expected network failure")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .networkFailure)
        }

        let signInRequests = await provider.signInRequests()
        XCTAssertEqual(signInRequests, 0)
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
        XCTAssertEqual(requests[1].url.path, "/api/auth/session")
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
        XCTAssertEqual(request.headers["Authorization"], authorization("session.fixture.token"))
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testListsAndRunsToolsWithUnknownFieldsIgnored() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: [[
                "name": "read_fixture",
                "description": "Synthetic read tool",
                "inputSchema": ["type": "object", "properties": [:]],
                "futureMetadata": ["ignored": true],
            ]])),
            .response(jsonResponse(status: 200, body: [
                "tool": "read_fixture",
                "outcome": "ok",
                "result": ["value": "synthetic", "futureField": 1],
                "confirmation": "Synthetic completion.",
                "futureResponseField": "ignored",
            ])),
        ])
        let client = try makeClient(transport: transport)

        let tools = try await client.listTools()
        let result: ToolCallResponse<JSONValue> = try await client.runTool(
            "read_fixture",
            arguments: ["query": "synthetic"],
            messageId: "42"
        )

        XCTAssertEqual(tools.first?.name, "read_fixture")
        XCTAssertEqual(result.tool, "read_fixture")
        XCTAssertEqual(result.outcome, .ok)
        XCTAssertEqual(result.confirmation, "Synthetic completion.")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map { $0.headers["Authorization"] }, [
            authorization("entra.fixture.token"),
            authorization("entra.fixture.token"),
        ])
        XCTAssertEqual(requests[1].headers["x-jarvis-message-id"], "42")
        XCTAssertEqual(requests[1].url.path, "/api/tools/read_fixture")
        XCTAssertEqual(requests[1].method, .post)
    }

    func testReadsVoiceLanguageFromExistingSettingsRoute() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: [
                "settings": ["voice": ["defaultLanguage": "en"]],
                "options": ["ignored": true],
            ])),
            .response(jsonResponse(status: 200, body: [
                "settings": ["voice": [:]],
                "options": ["ignored": true],
            ])),
        ])
        let client = try makeClient(
            transport: transport,
            tokenStore: FakeTokenStore(token: "session.fixture.token")
        )

        let configuredLanguage = try await client.voiceDefaultLanguage()
        let fallbackLanguage = try await client.voiceDefaultLanguage()
        XCTAssertEqual(configuredLanguage, .en)
        XCTAssertEqual(fallbackLanguage, .da)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.url.path), ["/api/settings", "/api/settings"])
        XCTAssertEqual(requests.map(\.method), [.get, .get])
        XCTAssertEqual(requests.map { $0.headers["Authorization"] }, [
            authorization("session.fixture.token"),
            authorization("session.fixture.token"),
        ])
    }

    func testUploadsVoiceFrameThroughExistingScreenVisionRoute() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: [
                "frameId": "frame_fixture",
                "capturedAt": "2026-10-30T00:00:00.000Z",
                "question": "What is shown?",
                "turnId": "item_fixture",
            ])),
        ])
        let client = try makeClient(
            transport: transport,
            tokenStore: FakeTokenStore(token: "session.fixture.token")
        )

        let frame = try await client.uploadVoiceFrame(
            sessionId: "41",
            jpeg: Data([0xff, 0xd8, 0x00, 0xff, 0xd9]),
            question: "What is shown?",
            turnId: "item_fixture"
        )

        XCTAssertEqual(frame.frameId, "frame_fixture")
        XCTAssertEqual(frame.turnId, "item_fixture")
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/api/screen/frames")
        XCTAssertEqual(request.headers["Authorization"], authorization("session.fixture.token"))
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(request.body)) as? [String: String]
        )
        XCTAssertEqual(body["sessionId"], "41")
        XCTAssertEqual(body["frame"], "/9gA/9k=")
        XCTAssertEqual(body["question"], "What is shown?")
        XCTAssertEqual(body["turnId"], "item_fixture")
        XCTAssertEqual(body["mode"], "handle")
    }

    func testInspectsSharedVoiceFrameThroughExistingScreenVisionRoute() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: [
                "description": "A chart with three bars.",
                "capturedAt": "2026-10-30T00:00:00.000Z",
            ])),
        ])
        let client = try makeClient(
            transport: transport,
            tokenStore: FakeTokenStore(token: "session.fixture.token")
        )

        let inspection = try await client.inspectVoiceScreenFrame(
            sessionId: "41",
            jpeg: Data([0xff, 0xd8, 0x00, 0xff, 0xd9])
        )

        XCTAssertEqual(inspection.description, "A chart with three bars.")
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/api/screen/frames")
        XCTAssertEqual(request.headers["Authorization"], authorization("session.fixture.token"))
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(request.body)) as? [String: String]
        )
        XCTAssertEqual(body, ["sessionId": "41", "frame": "/9gA/9k="])
    }

    func testRejectsInvalidVoiceFrameBeforeSending() async throws {
        let transport = FakeHTTPTransport([])
        let client = try makeClient(transport: transport)

        do {
            _ = try await client.uploadVoiceFrame(
                sessionId: "0",
                jpeg: Data([0xff, 0xd8, 0xff, 0xd9]),
                question: "What is shown?",
                turnId: "item_fixture"
            )
            XCTFail("Expected invalid-request error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .invalidRequest)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
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

    func testMapsRateLimitRetryAfterAndGenericStatus() async throws {
        let rateLimited = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 429, headers: ["rEtRy-AfTeR": "17"])),
        ])
        let client = try makeClient(transport: rateLimited, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await client.listTools()
            XCTFail("Expected rate-limit error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .rateLimited(retryAfter: .seconds(17)))
        }

        let generic = FakeHTTPTransport([.response(HTTPResponse(statusCode: 418))])
        let genericClient = try makeClient(transport: generic, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await genericClient.listTools()
            XCTFail("Expected generic HTTP error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .httpStatus(418))
        }

        let longRetryAfter = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 429, headers: ["Retry-After": "17"])),
            .response(HTTPResponse(statusCode: 200, body: Data("[]".utf8))),
        ])
        let boundedClient = try makeClient(
            transport: longRetryAfter,
            retryPolicy: RetryPolicy(maximumRetries: 1, delay: .zero, maximumDelay: .seconds(2))
        )
        do {
            _ = try await boundedClient.listTools()
            XCTFail("Expected rate-limit error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .rateLimited(retryAfter: .seconds(17)))
        }
        let requests = await longRetryAfter.recordedRequests()
        XCTAssertEqual(requests.count, 1)
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

        let exhausted = FakeHTTPTransport(Array(repeating: .response(HTTPResponse(statusCode: 503)), count: 5))
        let boundedClient = try makeClient(
            transport: exhausted,
            retryPolicy: RetryPolicy(maximumRetries: 99, delay: .zero, maximumDelay: .zero)
        )
        do {
            _ = try await boundedClient.listTools()
            XCTFail("Expected service-unavailable error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        let exhaustedRequests = await exhausted.recordedRequests()
        XCTAssertEqual(exhaustedRequests.count, 4)
    }

    func testDoesNotRetryToolSideEffect() async throws {
        let transport = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 503)),
            .response(HTTPResponse(statusCode: 200, body: Data("{}".utf8))),
        ])
        let client = try makeClient(
            transport: transport,
            retryPolicy: RetryPolicy(maximumRetries: 3, delay: .zero, maximumDelay: .zero)
        )

        do {
            let _: ToolCallResponse<JSONValue> = try await client.runTool(
                "change_fixture",
                arguments: [String: String]()
            )
            XCTFail("Expected service-unavailable error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
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

    func testRejectsInvalidToolNamesAndMessageIDs() async throws {
        let transport = FakeHTTPTransport([])
        let client = try makeClient(transport: transport)

        do {
            let _: ToolCallResponse<JSONValue> = try await client.runTool(
                "../tools",
                arguments: [String: String]()
            )
            XCTFail("Expected invalid-request error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .invalidRequest)
        }
        do {
            let _: ToolCallResponse<JSONValue> = try await client.runTool(
                "read_fixture",
                arguments: [String: String](),
                messageId: "0"
            )
            XCTFail("Expected invalid-request error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .invalidRequest)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
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
        retryPolicy: RetryPolicy = RetryPolicy()
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
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
