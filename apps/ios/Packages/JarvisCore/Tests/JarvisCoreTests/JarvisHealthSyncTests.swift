import XCTest
@testable import JarvisCore

private actor RecordingSender: JarvisHealthIngestSender {
    var calls: [(Data, String, String)] = []
    var fail = false
    func send(payload: Data, automationId: String, sessionId: String) async throws {
        if fail { throw JarvisHealthSyncError.unavailable }
        calls.append((payload, automationId, sessionId))
    }
    func setFail() { fail = true }
}

final class JarvisHealthSyncTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func batch(denied: [String] = []) -> JarvisHealthSyncBatch {
        JarvisHealthSyncBatch(
            samples: [
                JarvisHealthSample(metric: "step_count", unit: "count", start: t0, end: t0 + 60, value: 120),
                JarvisHealthSample(metric: "heart_rate", unit: "count/min", start: t0, end: t0, value: 61),
            ],
            sleep: [JarvisHealthSleepSegment(stage: "deep", start: t0, end: t0 + 3600)],
            workouts: [JarvisHealthWorkoutSample(
                id: "w1", activity: "Running", start: t0, end: t0 + 1800, activeEnergyKcal: 250, distanceMetres: 5000
            )],
            readTypes: ["step_count", "heart_rate", "sleep_analysis", "workout"],
            deniedOrUnreadTypes: denied, windowStart: t0, windowEnd: t0 + 7200
        )
    }

    func testPayloadUsesIngestShapeAndIsDeterministic() throws {
        let first = try JarvisHealthPayloadBuilder.payload(batch())
        XCTAssertEqual(first, try JarvisHealthPayloadBuilder.payload(batch()))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: first) as? [String: Any])
        let data = try XCTUnwrap(root["data"] as? [String: Any])
        let metrics = try XCTUnwrap(data["metrics"] as? [[String: Any]])
        XCTAssertEqual(metrics.compactMap { $0["name"] as? String }, ["heart_rate", "step_count", "sleep_analysis"])
        let workout = try XCTUnwrap((data["workouts"] as? [[String: Any]])?.first)
        XCTAssertEqual(workout["id"] as? String, "w1")
        XCTAssertEqual(workout["duration"] as? Double, 1800)
        XCTAssertEqual((workout["distance"] as? [String: Any])?["units"] as? String, "km")
    }

    func testSessionIdFollowsContent() throws {
        let a = try JarvisHealthPayloadBuilder.payload(batch())
        var changed = batch()
        changed = JarvisHealthSyncBatch(
            samples: changed.samples + [JarvisHealthSample(metric: "step_count", unit: "count", start: t0 + 1, end: t0 + 2, value: 1)],
            sleep: changed.sleep, workouts: changed.workouts, readTypes: changed.readTypes,
            deniedOrUnreadTypes: [], windowStart: t0, windowEnd: t0
        )
        let b = try JarvisHealthPayloadBuilder.payload(changed)
        XCTAssertEqual(JarvisHealthPayloadBuilder.sessionId(for: a), JarvisHealthPayloadBuilder.sessionId(for: a))
        XCTAssertNotEqual(JarvisHealthPayloadBuilder.sessionId(for: a), JarvisHealthPayloadBuilder.sessionId(for: b))
    }

    func testCompleteOnlyWhenEveryTypeWasRead() async {
        let sender = RecordingSender()
        let runner = JarvisHealthSyncRunner(sender: sender, now: { Date(timeIntervalSince1970: 5) })
        let complete = await runner.sync(batch())
        XCTAssertEqual(complete, .complete(at: Date(timeIntervalSince1970: 5)))
        let partial = await runner.sync(batch(denied: ["nutrition", "body_mass"]))
        XCTAssertEqual(partial, .partial(at: Date(timeIntervalSince1970: 5), missingTypes: ["body_mass", "nutrition"]))
        let calls = await sender.calls
        XCTAssertEqual(calls.count, 2)
        XCTAssertEqual(calls[0].1, "jarvis-ios")
    }

    func testFailedUploadIsNeverReportedAsComplete() async {
        let sender = RecordingSender()
        await sender.setFail()
        let runner = JarvisHealthSyncRunner(sender: sender)
        let state = await runner.sync(batch())
        XCTAssertEqual(state, .failed)
        let none = await runner.sync(JarvisHealthSyncBatch(
            samples: [], sleep: [], workouts: [], readTypes: [], deniedOrUnreadTypes: [], windowStart: t0, windowEnd: t0
        ))
        XCTAssertEqual(none, .failed)
    }
}
