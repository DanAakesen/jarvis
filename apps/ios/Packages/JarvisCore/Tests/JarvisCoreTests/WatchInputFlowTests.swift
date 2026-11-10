import Foundation
import XCTest
@testable import JarvisCore

final class WatchInputFlowTests: XCTestCase {
    func testUnchangedAndRevisitedDraftKeepSubmissionIdentity() throws {
        var state = WatchFactorySubmissions()
        let draft = WatchFactoryDraft(projectID: "7", title: " Build ", request: " A fixture task ", agent: .codex)
        let first = try XCTUnwrap(state.submission(for: draft))
        XCTAssertEqual(first.title, "Build")
        XCTAssertEqual(first.request, "A fixture task")
        XCTAssertEqual(state.submission(for: draft)?.submissionId, first.submissionId)
        let changed = WatchFactoryDraft(projectID: "7", title: "Other", request: "A fixture task", agent: .codex)
        XCTAssertNotEqual(state.submission(for: changed)?.submissionId, first.submissionId)
        XCTAssertEqual(state.submission(for: draft)?.submissionId, first.submissionId)
    }
    func testFactoryEnvelopeBindsProjectAndIdempotencyIdentity() throws {
        var state = WatchFactorySubmissions()
        let value = try XCTUnwrap(state.submission(for: .init(projectID: "7", title: "Test", request: "Fixture only", agent: .copilot)))
        let data = try WatchCodec.encode(value)
        var request = WatchRequest(action: .createFactoryTask, itemID: "7", data: data, id: try XCTUnwrap(UUID(uuidString: value.submissionId)))
        XCTAssertTrue(request.isValid)
        XCTAssertEqual(request.factorySubmission, value)
        let roundTrip = try JSONDecoder().decode(WatchRequest.self, from: WatchCodec.encode(request))
        XCTAssertEqual(roundTrip.factorySubmission?.submissionId, value.submissionId)
        request.itemID = "8"; XCTAssertFalse(request.isValid)
        request.itemID = "7"; request.id = UUID(); XCTAssertFalse(request.isValid)
        request.data = Data("{}".utf8); XCTAssertFalse(request.isValid)
    }
    func testFactoryDraftValidationUsesWatchByteLimitAndRealProjectIDs() {
        var state = WatchFactorySubmissions()
        for draft in [
            WatchFactoryDraft(projectID: "7", title: " ", request: "Task", agent: .codex),
            .init(projectID: "7", title: "Task", request: " ", agent: .codex),
            .init(projectID: "https://example.com", title: "Task", request: "Task", agent: .codex),
            .init(projectID: "7", title: String(repeating: "a", count: 201), request: "Task", agent: .codex),
            .init(projectID: "7", title: "Task", request: String(repeating: "🟠", count: 2001), agent: .codex)
        ] { XCTAssertNil(state.submission(for: draft)) }
        XCTAssertNotNil(state.submission(for: .init(projectID: "7", title: "Task", request: String(repeating: "a", count: 8000), agent: .codex)))
    }
    func testAttemptBoundNeverEvictsAnOldRetryIdentity() throws {
        var state = WatchFactorySubmissions()
        let original = WatchFactoryDraft(projectID: "7", title: "0", request: "Fixture", agent: .codex)
        let first = try XCTUnwrap(state.submission(for: original))
        for number in 1..<32 {
            XCTAssertNotNil(state.submission(for: .init(projectID: "7", title: String(number), request: "Fixture", agent: .codex)))
        }
        XCTAssertNil(state.submission(for: .init(projectID: "7", title: "33", request: "Fixture", agent: .codex)))
        XCTAssertEqual(state.submission(for: original)?.submissionId, first.submissionId)
    }
    func testEmptyHistoryIsValidAndNotAConnectivityFailure() throws {
        let empty = try result(status: "empty", items: [])
        XCTAssertTrue(try WatchHealthHistory.items(from: empty).isEmpty)
        let available = try result(status: "available", items: [["exerciseName": .string("Bench")]])
        XCTAssertEqual(try WatchHealthHistory.items(from: available).count, 1)
    }
    func testUnavailableOrInconsistentHistoryDoesNotBecomeAnEmptySuccess() throws {
        for status in ["disabled", "unavailable", "failed"] {
            XCTAssertThrowsError(try WatchHealthHistory.items(from: result(status: status, items: []))) {
                XCTAssertEqual($0 as? WatchFailure, .healthUnavailable)
                XCTAssertNotEqual(($0 as? WatchFailure)?.message, WatchFailure.unavailable.message)
            }
        }
        XCTAssertThrowsError(try WatchHealthHistory.items(from: result(status: "empty", items: [["id": .string("unexpected")]])))
    }
    private func result(status: String, items: [[String: JSONValue]]) throws -> JarvisHealthQueryResult {
        struct Envelope: Encodable {
            let source = "daily.health.lifts"
            let status: String
            let items: [[String: JSONValue]]
            let coverage: Coverage
            struct Coverage: Encodable { let returned: Int; let hasMore = false; let next: String? = nil }
        }
        return try JSONDecoder().decode(JarvisHealthQueryResult.self, from: JSONEncoder().encode(
            Envelope(status: status, items: items, coverage: .init(returned: items.count))))
    }
}
