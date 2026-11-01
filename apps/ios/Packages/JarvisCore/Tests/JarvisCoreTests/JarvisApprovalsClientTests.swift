import Foundation
import XCTest
@testable import JarvisCore

final class JarvisApprovalsClientTests: XCTestCase {
    func testCalendarProposalFitsAlongsideExistingApprovalsWithoutTruncation() async throws {
        let existing = (0..<10).map { index in
            ["id": String(repeating: String(index), count: 43), "actionKind": "merge",
             "summary": "Existing request", "expiresAt": "2026-10-30T19:00:00.000Z"]
        }
        let summary = String(repeating: "x", count: 40_000)
        let calendar = ["id": String(repeating: "Z", count: 43), "actionKind": "calendar_change",
                        "summary": summary, "expiresAt": "2026-10-30T19:00:00.000Z"]
        let transport = FakeApprovalsTransport([HTTPResponse(statusCode: 200, body: json([
            "confirmations": existing + [calendar], "awayMode": false,
            "updatedAt": "2026-10-30T18:59:00.000Z",
        ]))])
        let pending = try await makeApprovalsClient(transport: transport).pendingConfirmations()
        XCTAssertEqual(pending.confirmations.count, 11)
        XCTAssertEqual(pending.confirmations.last?.summary, summary)
    }

    func testCalendarFeedExpansionPreservesOtherApprovalBounds() async throws {
        for (count, kind, size) in [
            (2, "calendar_change", 100), (1, "calendar_change", 40_001),
            (11, "merge", 100), (1, "merge", 4_001),
        ] {
            let confirmations = (0..<count).map { _ in
                ["id": String(repeating: "A", count: 43), "actionKind": kind,
                 "summary": String(repeating: "x", count: size),
                 "expiresAt": "2026-10-30T19:00:00.000Z"]
            }
            let transport = FakeApprovalsTransport([HTTPResponse(statusCode: 200, body: json([
                "confirmations": confirmations, "awayMode": false,
                "updatedAt": "2026-10-30T18:59:00.000Z",
            ]))])
            do {
                _ = try await makeApprovalsClient(transport: transport).pendingConfirmations()
                XCTFail("Expected approval bounds to be enforced")
            } catch {
                XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidResponse)
            }
        }
    }

    func testListsPendingConfirmationsAndIgnoresUnknownFields() async throws {
        let transport = FakeApprovalsTransport([
            HTTPResponse(statusCode: 200, body: json([
                "confirmations": [[
                    "id": String(repeating: "A", count: 43),
                    "actionKind": "merge",
                    "summary": "Deploy the synthetic model",
                    "expiresAt": "2026-10-30T19:00:00.000Z",
                    "futureField": "ignored",
                ]],
                "awayMode": false,
                "updatedAt": "2026-10-30T18:59:00.000Z",
                "futureFeedField": true,
            ])),
        ])
        let approvals = makeApprovalsClient(transport: transport)

        let pending = try await approvals.pendingConfirmations()

        XCTAssertEqual(pending.confirmations, [
            PendingConfirmation(
                id: String(repeating: "A", count: 43),
                actionKind: .merge,
                summary: "Deploy the synthetic model",
                expiresAt: "2026-10-30T19:00:00.000Z"
            ),
        ])
        XCTAssertFalse(pending.awayMode)
        XCTAssertEqual(pending.updatedAt, "2026-10-30T18:59:00.000Z")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.first?.method, .get)
        XCTAssertEqual(requests.first?.url.path, "/api/now")
    }

    func testDecisionUsesExistingRouteAndOnly204IsSuccess() async throws {
        let transport = FakeApprovalsTransport([
            HTTPResponse(statusCode: 204),
            HTTPResponse(statusCode: 204),
        ])
        let approvals = makeApprovalsClient(transport: transport)
        let id = String(repeating: "f", count: 43)

        try await approvals.resolveConfirmation(id: id, decision: .approve)
        try await approvals.resolveConfirmation(id: id, decision: .reject)

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.url.path), [
            "/api/now/confirmations/\(id)",
            "/api/now/confirmations/\(id)",
        ])
        XCTAssertEqual(requests.compactMap(\.body).map { String(decoding: $0, as: UTF8.self) }, [
            #"{"decision":"approve"}"#,
            #"{"decision":"reject"}"#,
        ])
    }

    func testRegistersAndRemovesAnAuthenticatedApprovalNotificationDevice() async throws {
        let token = String(repeating: "ab", count: 32)
        let transport = FakeApprovalsTransport([
            HTTPResponse(statusCode: 204),
            HTTPResponse(statusCode: 204),
        ])
        let approvals = makeApprovalsClient(transport: transport)

        try await approvals.registerDeviceToken(token, language: .en, showActions: true)
        try await approvals.unregisterDeviceToken(token)

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .delete])
        XCTAssertEqual(requests.map(\.url.path), [
            "/api/ios/approval-notifications",
            "/api/ios/approval-notifications",
        ])
        let bodies = try requests.compactMap(\.body).map {
            try XCTUnwrap(JSONSerialization.jsonObject(with: $0) as? [String: Any])
        }
        XCTAssertEqual(bodies[0]["deviceToken"] as? String, token)
        XCTAssertEqual(bodies[0]["language"] as? String, "en")
        XCTAssertEqual(bodies[0]["showActions"] as? Bool, true)
        XCTAssertEqual(bodies[1]["deviceToken"] as? String, token)
    }

    func testRejectsMalformedApprovalNotificationDeviceTokens() async throws {
        let transport = FakeApprovalsTransport([])
        let approvals = makeApprovalsClient(transport: transport)

        do {
            try await approvals.registerDeviceToken("not-a-token", language: .da, showActions: true)
            XCTFail("Expected invalid device token rejection")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidResponse)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testMapsDecisionStatusesWithoutRetrying() async throws {
        let id = String(repeating: "B", count: 43)
        let cases: [(Int, any Error)] = [
            (403, JarvisClientError.notOwner),
            (404, JarvisApprovalsClientError.confirmationUnavailable),
            (409, JarvisApprovalsClientError.awayMode),
            (503, JarvisClientError.serviceUnavailable),
        ]

        for (status, expectedError) in cases {
            let transport = FakeApprovalsTransport([HTTPResponse(statusCode: status)])
            let approvals = makeApprovalsClient(transport: transport)
            do {
                try await approvals.resolveConfirmation(id: id, decision: .approve)
                XCTFail("Expected HTTP \(status) to fail")
            } catch {
                XCTAssertEqual(String(describing: error), String(describing: expectedError))
            }
            let requests = await transport.recordedRequests()
            XCTAssertEqual(requests.count, 1)
        }

        let notFound = FakeApprovalsTransport([HTTPResponse(statusCode: 404)])
        do {
            try await makeApprovalsClient(transport: notFound)
                .resolveConfirmation(id: id, decision: .reject)
            XCTFail("A missing confirmation must not succeed")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .confirmationUnavailable)
        }
    }

    func testRejectsInvalidConfirmationIDsAndMalformedFeed() async throws {
        let transport = FakeApprovalsTransport([
            HTTPResponse(statusCode: 200, body: json([
                "confirmations": [[
                    "id": "fake",
                    "actionKind": "unknown",
                    "summary": "Synthetic",
                    "expiresAt": "not-a-date",
                ]],
                "awayMode": false,
                "updatedAt": "2026-10-30T18:59:00.000Z",
            ])),
        ])
        let approvals = makeApprovalsClient(transport: transport)

        do {
            try await approvals.resolveConfirmation(id: "not-an-id", decision: .approve)
            XCTFail("Expected local ID validation")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidConfirmationID)
        }
        do {
            _ = try await approvals.pendingConfirmations()
            XCTFail("Expected malformed feed rejection")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .invalidResponse)
        }
    }

    private func makeApprovalsClient(transport: FakeApprovalsTransport) -> JarvisApprovalsClient {
        let client = try! JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 2, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: ApprovalsTokenStore(),
            accessTokenProvider: ApprovalsTokenProvider()
        )
        return JarvisApprovalsClient(client: client)
    }
}

private actor FakeApprovalsTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw HTTPTransportFailure.network }
        return responses.removeFirst()
    }

    func recordedRequests() -> [HTTPRequest] { requests }
}

private actor ApprovalsTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor ApprovalsTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

private func json(_ value: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
}
