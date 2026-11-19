import Foundation
import XCTest
@testable import JarvisCore

final class JarvisStatusEvidenceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_795_053_600)

    func testMissingOrStaleEvidenceStaysUnknownInsteadOfFalseDegraded() {
        XCTAssertEqual(JarvisStatusLogic.smokeStatus(nil, now: now), .unknown)
        let entry = JarvisStatusSmokeEntry(id: "chat_canary", status: .unknown, checkedAt: "2026-11-19T01:59:00Z")
        let unknown = JarvisStatusSmoke(checkedAt: "2026-11-19T01:59:00Z", entries: [entry])
        XCTAssertEqual(JarvisStatusLogic.smokeStatus(unknown, now: now), .unknown)

        let old = JarvisStatusSmokeEntry(id: "research", status: .ok, checkedAt: "2026-11-19T01:00:00Z")
        XCTAssertEqual(
            JarvisStatusLogic.smokeStatus(
                JarvisStatusSmoke(checkedAt: "2026-11-19T01:00:00Z", entries: [old]),
                now: now
            ),
            .unknown
        )
    }

    func testStatusReasonsDistinguishUnavailableNeverProbedAndStaleRuntimeEvidence() {
        let missing = JarvisStatusEntry(
            id: "foundry.chat", status: .down, checkedAt: "2026-11-19T02:00:00Z",
            details: ["configured": .bool(false), "reason": .string("active_engine_unconfigured")]
        )
        XCTAssertEqual(JarvisStatusLogic.reason(for: missing), .key(.statusReasonActiveEngineMissing))

        let never = JarvisStatusEntry(
            id: "foundry.voice", status: .unknown, checkedAt: "2026-11-19T02:00:00Z",
            details: ["configured": .bool(true), "runtimeProbe": .string("not_run")]
        )
        XCTAssertEqual(JarvisStatusLogic.reason(for: never), .key(.statusReasonPiNotProbed))

        let stale = JarvisStatusEntry(
            id: "foundry.embeddings", status: .unknown, checkedAt: "2026-11-19T01:00:00Z",
            details: ["configured": .bool(true), "runtimeProbe": .string("stale")]
        )
        XCTAssertEqual(JarvisStatusLogic.reason(for: stale), .key(.statusReasonRuntimeStale))
    }

    func testMirrorDecodingRetainsLastRunOutcomeAndReadReason() throws {
        let data = Data("""
        {
          "state":"read-error",
          "lastSuccessAt":null,
          "lastRunAt":"2026-11-19T01:50:00Z",
          "outcome":"failed",
          "readReason":"access-denied"
        }
        """.utf8)
        let mirror = try JSONDecoder().decode(JarvisVaultMirror.self, from: data)
        XCTAssertEqual(mirror.lastRunAt, "2026-11-19T01:50:00Z")
        XCTAssertEqual(mirror.outcome, "failed")
        XCTAssertEqual(mirror.readReason, "access-denied")
    }
}
