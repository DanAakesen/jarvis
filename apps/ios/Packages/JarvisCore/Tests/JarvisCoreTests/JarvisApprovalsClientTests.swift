import Foundation
import XCTest
@testable import JarvisCore

final class JarvisApprovalsClientTests: XCTestCase {
    func testListsPendingConfirmationsAndIgnoresUnknownFields() async throws {
        let transport = FakeApprovalsTransport([
            HTTPResponse(statusCode: 200, body: json([
                "confirmations": [[
                    "id": String(repeating: "A", count: 43),
                    "actionKind": "model_deployment",
                    "summary": "Deploy the synthetic model",
                    "expiresAt": "2026-10-30T19:00:00.000Z",
                    "futureField": "ignored",
                ]],
                "futureFeedField": true,
            ])),
        ])
        let approvals = makeApprovalsClient(transport: transport)

        let confirmations = try await approvals.pendingConfirmations()

        XCTAssertEqual(confirmations, [
            PendingConfirmation(
                id: String(repeating: "A", count: 43),
                actionKind: .modelDeployment,
                summary: "Deploy the synthetic model",
                expiresAt: "2026-10-30T19:00:00.000Z"
            ),
        ])
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

        try await approvals.decide(id: id, decision: .approve)
        try await approvals.decide(id: id, decision: .reject)

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

    func testMapsDecisionStatusesWithoutRetrying() async throws {
        let id = String(repeating: "B", count: 43)
        let cases: [(Int, any Error)] = [
            (403, JarvisClientError.notOwner),
            (404, JarvisApprovalsClientError.noLongerAvailable),
            (503, JarvisClientError.serviceUnavailable),
        ]

        for (status, expectedError) in cases {
            let transport = FakeApprovalsTransport([HTTPResponse(statusCode: status)])
            let approvals = makeApprovalsClient(transport: transport)
            do {
                try await approvals.decide(id: id, decision: .approve)
                XCTFail("Expected HTTP \(status) to fail")
            } catch {
                XCTAssertEqual(String(describing: error), String(describing: expectedError))
            }
            let requests = await transport.recordedRequests()
            XCTAssertEqual(requests.count, 1)
        }

        let notFound = FakeApprovalsTransport([HTTPResponse(statusCode: 404)])
        do {
            try await makeApprovalsClient(transport: notFound).decide(id: id, decision: .reject)
            XCTFail("A missing confirmation must not succeed")
        } catch {
            XCTAssertEqual(error as? JarvisApprovalsClientError, .noLongerAvailable)
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
            ])),
        ])
        let approvals = makeApprovalsClient(transport: transport)

        do {
            try await approvals.decide(id: "not-an-id", decision: .approve)
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
