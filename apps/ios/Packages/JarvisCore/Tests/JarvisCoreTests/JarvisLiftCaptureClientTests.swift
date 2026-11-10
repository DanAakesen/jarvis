import Foundation
import XCTest
@testable import JarvisCore

final class JarvisLiftCaptureClientTests: XCTestCase {
    func testCaptureUsesAuthenticatedRouteWithExactTextAndOperationKey() async throws {
        let transport = CaptureTransport(responses: [
            .init(statusCode: 200, body: Data(#"{"status":"needsDetails","question":"How many reps?"}"#.utf8)),
            .init(statusCode: 201, body: Data(#"{"status":"saved","entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench press","weightKg":80,"reps":4,"sets":3,"performedAt":"2026-11-10T12:00:00Z"},"replayed":false}"#.utf8)),
            .init(statusCode: 200, body: Data(#"{"status":"saved","entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench press","weightKg":80,"reps":4,"sets":3,"performedAt":"2026-11-10T12:00:00Z"},"replayed":true}"#.utf8))
        ])
        let health = try client(transport)
        let key = UUID()
        let original = JarvisLiftCaptureRequest(idempotencyKey: key, text: " Bench press, 80 kg, 3 sets ")
        let missing = try await health.captureLift(original)
        XCTAssertEqual(missing, .needsDetails(question: "How many reps?"))
        let clarified = JarvisLiftCaptureRequest(idempotencyKey: key, text: original.text + ", 4 reps")
        guard case .saved(let entry, false) = try await health.captureLift(clarified) else { return XCTFail("Expected saved receipt") }
        XCTAssertEqual(entry.exerciseName, "Bench press")
        XCTAssertEqual(entry.weightKg, 80)
        XCTAssertEqual(entry.reps, 4)
        XCTAssertEqual(entry.sets, 3)
        guard case .saved(_, true) = try await health.captureLift(clarified) else { return XCTFail("Expected replay receipt") }
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 3)
        for request in requests {
            XCTAssertEqual(request.method, .post)
            XCTAssertEqual(request.url.path, "/api/health/lifts/capture")
            XCTAssertEqual(request.headers["Authorization"], ["Bear", "er"].joined() + " " + "capture.fixture.owner")
            XCTAssertEqual(request.headers["Content-Type"], "application/json")
        }
        let bodies = try requests.map { try JSONDecoder().decode(JarvisLiftCaptureRequest.self, from: XCTUnwrap($0.body)) }
        XCTAssertEqual(bodies, [original, clarified, clarified])
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(requests[0].body)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["text", "idempotencyKey"])
    }

    func testUnavailableResponseDoesNotAutomaticallyResendEvenWithRetryPolicy() async throws {
        let transport = CaptureTransport(responses: [.init(statusCode: 503), .init(statusCode: 200)])
        let health = try client(transport)
        do {
            _ = try await health.captureLift(.init(idempotencyKey: UUID(), text: "Bench press"))
            XCTFail("Expected unavailable")
        } catch { }
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
    }

    func testOnlyVerifiedGoneCodeBecomesTerminalDeletedResult() async throws {
        let transport = CaptureTransport(responses: [
            .init(statusCode: 410, body: Data(#"{"code":"lift_deleted","error":"Untrusted provider detail that must not be shown"}"#.utf8))
        ])
        let result = try await client(transport).captureLift(.init(idempotencyKey: UUID(), text: "Bench press, 80 kg, 4 reps"))
        XCTAssertEqual(result, .deleted)
        let wire = try WatchCodec.encode(result)
        XCTAssertEqual(try JSONDecoder().decode(JarvisLiftCaptureResult.self, from: wire), .deleted)
        XCTAssertFalse(String(decoding: wire, as: UTF8.self).contains("Untrusted"))
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
    }

    func testUnverifiedGoneOrDeletedStatusRemainsFailure() async throws {
        for response in [
            HTTPResponse(statusCode: 410, body: Data(#"{"code":"other","error":"Gone"}"#.utf8)),
            HTTPResponse(statusCode: 410, body: Data(#"{"error":"Gone"}"#.utf8)),
            HTTPResponse(statusCode: 410, body: Data("not JSON".utf8)),
            HTTPResponse(statusCode: 400, body: Data(#"{"code":"lift_deleted"}"#.utf8)),
            HTTPResponse(statusCode: 404, body: Data(#"{"code":"lift_deleted"}"#.utf8)),
            HTTPResponse(statusCode: 503, body: Data(#"{"code":"lift_deleted"}"#.utf8)),
            HTTPResponse(statusCode: 200, body: Data(#"{"status":"deleted"}"#.utf8))
        ] {
            let transport = CaptureTransport(responses: [response])
            do {
                _ = try await client(transport).captureLift(.init(idempotencyKey: UUID(), text: "Bench press"))
                XCTFail("Unverified deletion must not unlock an uncertain operation")
            } catch { }
            let count = await transport.requests.count
            XCTAssertEqual(count, 1)
        }
    }

    func testNetworkTimeoutDoesNotAutomaticallyResend() async throws {
        let transport = CaptureTransport(responses: [])
        let health = try client(transport)
        do {
            _ = try await health.captureLift(.init(idempotencyKey: UUID(), text: "Bench press"))
            XCTFail("Expected timeout")
        } catch { }
        let count = await transport.requests.count
        XCTAssertEqual(count, 1)
    }

    func testEmptyAndOversizedInputNeverReachTransport() async throws {
        let transport = CaptureTransport(responses: [])
        let health = try client(transport)
        for text in [" \n", "Bench\u{0000}", "Bench\u{200b}", String(repeating: "a", count: 2001), String(repeating: "🟠", count: 1001), String(repeating: "a", count: 8001)] {
            do {
                _ = try await health.captureLift(.init(idempotencyKey: UUID(), text: text))
                XCTFail("Expected invalid request")
            } catch { XCTAssertEqual(error as? JarvisClientError, .invalidRequest) }
        }
        let count = await transport.requests.count
        XCTAssertEqual(count, 0)
    }

    func testMalformedAndFailedResponsesNeverReportSaved() async throws {
        for response in [
            HTTPResponse(statusCode: 200, body: Data(#"{"status":"saved","entry":{},"replayed":false}"#.utf8)),
            HTTPResponse(statusCode: 200, body: Data(#"{"status":"needsDetails","question":""}"#.utf8)),
            HTTPResponse(statusCode: 200, body: Data(#"{"status":"saved","entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench","weightKg":80,"reps":4,"sets":3,"performedAt":"2026-11-10T12:00:00Z","deletedAt":"2026-11-10T12:30:00Z"},"replayed":true}"#.utf8)),
            HTTPResponse(statusCode: 409),
            HTTPResponse(statusCode: 401)
        ] {
            let transport = CaptureTransport(responses: [response])
            do {
                _ = try await client(transport).captureLift(.init(idempotencyKey: UUID(), text: "Bench press"))
                XCTFail("Expected failure")
            } catch { }
        }
    }

    private func client(_ transport: CaptureTransport) throws -> JarvisHealthClient {
        JarvisHealthClient(client: try JarvisClient(
            configuration: .init(baseURL: URL(string: "https://fixture.invalid/api")!,
                                 retryPolicy: .init(maximumRetries: 3, delay: .zero)),
            transport: transport, tokenStore: CaptureTokenStore(), accessTokenProvider: CaptureTokenProvider()
        ))
    }
}

private actor CaptureTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [HTTPRequest] = []
    init(responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw HTTPTransportFailure.timedOut }
        return responses.removeFirst()
    }
}

private actor CaptureTokenStore: TokenStore {
    func read() async throws -> String? { "capture.fixture.owner" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}
private struct CaptureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "capture.fixture.access" }
    func requestSignIn() async {}
}
