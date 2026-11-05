import XCTest
@testable import JarvisCore

private actor RecordingSender: JarvisHealthSyncSender {
    var requests: [JarvisHealthSyncRequest] = []
    var fail = false
    func send(_ request: JarvisHealthSyncRequest) async throws {
        if fail { throw JarvisHealthSyncError.unavailable }
        requests.append(request)
    }
    func setFail(_ value: Bool) { fail = value }
}

private final class MemoryAnchorStore: JarvisHealthSyncAnchorStore, @unchecked Sendable {
    var anchor: Date?
    var lastSync: Date?
    func save(anchor: Date, lastSync: Date) {
        self.anchor = anchor
        self.lastSync = lastSync
    }
}

final class JarvisHealthSyncTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func batch(denied: [String] = []) -> JarvisHealthSyncBatch {
        JarvisHealthSyncBatch(
            samples: [
                JarvisHealthSample(id: "s2", metric: "step_count", unit: "count", start: t0, end: t0 + 60, value: 120),
                JarvisHealthSample(id: "s1", metric: "heart_rate", unit: "count/min", start: t0, end: t0, value: 61),
                JarvisHealthSample(id: "s3", metric: "step_count", unit: "count", start: t0 + 60, end: t0 + 120, value: 5),
            ],
            sleep: [JarvisHealthSleepSegment(id: "z1", stage: "deep", start: t0, end: t0 + 3600)],
            workouts: [JarvisHealthWorkoutSample(
                id: "w1", activity: "Running", start: t0, end: t0 + 1800, activeEnergyKcal: 250, distanceMetres: 5000
            )],
            readTypes: ["step_count", "heart_rate", "sleep_analysis", "workout"],
            deniedOrUnreadTypes: denied, windowStart: t0, windowEnd: t0 + 7200
        )
    }

    func testRequestBodyCarriesSampleIdsAndIsDeterministic() throws {
        let first = try JarvisHealthSyncRequest.requests(for: batch(), anchor: t0)[1].encoded()
        XCTAssertEqual(first, try JarvisHealthSyncRequest.requests(for: batch(), anchor: t0)[1].encoded())
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: first) as? [String: Any])
        let samples = try XCTUnwrap(root["samples"] as? [[String: Any]])
        XCTAssertEqual(samples.compactMap { $0["id"] as? String }, ["s2", "s3"])
        XCTAssertEqual(samples.first?["metric"] as? String, "step_count")
        XCTAssertNotNil(root["anchor"] as? String)
    }

    func testRequestsKeepEachMetricWholeAndSendSleepAndWorkoutsSeparately() {
        let requests = JarvisHealthSyncRequest.requests(for: batch(), anchor: nil)
        XCTAssertEqual(requests.count, 4)
        XCTAssertEqual(requests[0].samples.map(\.metric), ["heart_rate"])
        XCTAssertEqual(requests[1].samples.map(\.id), ["s2", "s3"])
        XCTAssertEqual(requests[2].sleep.count, 1)
        XCTAssertEqual(requests[3].workouts.map(\.id), ["w1"])
        XCTAssertTrue(requests.allSatisfy { $0.anchor == nil })
    }

    func testFirstSyncReadsSevenWholeCalendarDaysAndLaterSyncsStartAtTheAnchorsDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(
            JarvisHealthSyncWindow.start(anchor: nil, now: now, calendar: calendar),
            calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now))
        )
        let anchor = now.addingTimeInterval(-3_600)
        XCTAssertEqual(
            JarvisHealthSyncWindow.start(anchor: anchor, now: now, calendar: calendar),
            calendar.startOfDay(for: anchor)
        )
        XCTAssertEqual(
            JarvisHealthSyncWindow.start(anchor: now.addingTimeInterval(86_400), now: now, calendar: calendar),
            calendar.startOfDay(for: now)
        )
    }

    func testSyncWindowUsesCopenhagenMidnightAcrossTheDSTBoundary() {
        let formatter = ISO8601DateFormatter()
        let now = formatter.date(from: "2026-10-25T23:30:00Z")!
        let start = JarvisHealthSyncWindow.recentStart(now: now, days: 7)
        XCTAssertEqual(formatter.string(from: start), "2026-10-19T22:00:00Z")
        XCTAssertEqual(JarvisHealthLogic.day(formatter.string(from: start)), "2026-10-20")
        let lateWorkout = formatter.date(from: "2026-10-19T22:30:00Z")!
        XCTAssertGreaterThanOrEqual(lateWorkout, start, "The first local day's workout must not be dropped at UTC midnight")
    }

    func testCompleteSyncSendsEverythingAndAdvancesTheAnchor() async {
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        let finished = Date(timeIntervalSince1970: 5)
        let runner = JarvisHealthSyncRunner(sender: sender, store: store, now: { finished })
        let state = await runner.sync(batch())
        XCTAssertEqual(state, .complete(at: finished))
        let sent = await sender.requests
        XCTAssertEqual(sent.count, 4)
        XCTAssertEqual(store.anchor, t0 + 7200)
        XCTAssertEqual(store.lastSync, finished)
    }

    func testLaterSyncSendsTheAnchorFromTheLastCompleteSync() async {
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        store.anchor = t0
        let runner = JarvisHealthSyncRunner(sender: sender, store: store)
        _ = await runner.sync(batch())
        let sent = await sender.requests
        XCTAssertTrue(sent.allSatisfy { $0.anchor == t0 })
    }

    func testPartialSyncNamesMissingTypesAndKeepsTheAnchor() async {
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        store.anchor = t0
        let finished = Date(timeIntervalSince1970: 5)
        let runner = JarvisHealthSyncRunner(sender: sender, store: store, now: { finished })
        let state = await runner.sync(batch(denied: ["nutrition", "body_mass"]))
        XCTAssertEqual(state, .partial(at: finished, missingTypes: ["body_mass", "nutrition"]))
        XCTAssertEqual(store.anchor, t0)
        XCTAssertNil(store.lastSync)
    }

    func testFailedUploadIsNeverReportedAsCompleteAndRetrySucceeds() async {
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        let runner = JarvisHealthSyncRunner(sender: sender, store: store)
        await sender.setFail(true)
        let failed = await runner.sync(batch())
        XCTAssertEqual(failed, .failed)
        XCTAssertNil(store.anchor)
        XCTAssertNil(store.lastSync)
        let none = await runner.sync(JarvisHealthSyncBatch(
            samples: [], sleep: [], workouts: [], readTypes: [], deniedOrUnreadTypes: [], windowStart: t0, windowEnd: t0
        ))
        XCTAssertEqual(none, .failed)
        await sender.setFail(false)
        let retried = await runner.sync(batch())
        guard case .complete = retried else { return XCTFail("retry should complete") }
        XCTAssertEqual(store.anchor, t0 + 7200)
    }

    func testBacklogLargerThanRequestLimitUploadsCompleteCopenhagenDays() async throws {
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-25T22:59:00Z"))
        let samples = (0..<24_000).map { index in
            let start = index < 12_000 ? date : date + 120
            return JarvisHealthSample(id: "s\(index)", metric: "active_energy", unit: "kcal",
                                      start: start, end: start, value: 1)
        }
        let large = JarvisHealthSyncBatch(samples: samples, sleep: [], workouts: [], readTypes: ["active_energy"],
                                         deniedOrUnreadTypes: [], windowStart: date, windowEnd: date + 120)
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        let state = await JarvisHealthSyncRunner(sender: sender, store: store).sync(large)
        guard case .complete = state else { return XCTFail("A multi-day backlog must complete") }
        let requests = await sender.requests
        XCTAssertEqual(requests.map { $0.samples.count }, [12_000, 12_000])
        XCTAssertEqual(requests.flatMap(\.samples).count, samples.count)
        XCTAssertEqual(store.anchor, large.windowEnd)
    }

    func testOversizedSingleDayIsNeverPartiallyUploadedOrAcknowledged() async {
        let samples = (0..<20_001).map { index in
            JarvisHealthSample(id: "s\(index)", metric: "heart_rate", unit: "count/min", start: t0, end: t0, value: 60)
        }
        let large = JarvisHealthSyncBatch(samples: samples, sleep: [], workouts: [], readTypes: ["heart_rate"],
                                         deniedOrUnreadTypes: [], windowStart: t0, windowEnd: t0 + 1)
        let sender = RecordingSender()
        let store = MemoryAnchorStore()
        let state = await JarvisHealthSyncRunner(sender: sender, store: store).sync(large)
        XCTAssertEqual(state, .failed)
        let requests = await sender.requests
        XCTAssertTrue(requests.isEmpty)
        XCTAssertNil(store.anchor)
    }

    func testLocalStepsPreserveMissingHistoryAndReplaceExplicitZeroByCopenhagenDay() throws {
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-25T23:30:00Z"))
        let retained: [[String: JSONValue]] = [
            ["metric_date": .string("2026-10-24"), "value": .number(9000)],
            ["metric_date": .string("2026-10-26"), "value": .number(1000)],
        ]
        let rows = JarvisHealthStepDays.merging(retained: retained, local: [date: 0])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0], retained[0])
        XCTAssertEqual(rows[1]["metric_date"], .string("2026-10-26"))
        XCTAssertEqual(rows[1]["value"], .number(0))
        XCTAssertEqual(JarvisHealthStepDays.merging(retained: retained, local: [:]), retained)
    }

    func testSyncLocalizationExistsInDanishAndEnglish() {
        for key in [JarvisHealthLocalizationKey.sync, .syncing, .syncNever, .syncComplete, .syncPartial, .syncFailed, .syncRetry, .lastSync] {
            XCTAssertNotEqual(JarvisHealthLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisHealthLocalization.string(key, language: .en), key.rawValue)
            XCTAssertNotEqual(
                JarvisHealthLocalization.string(key, language: .da), JarvisHealthLocalization.string(key, language: .en)
            )
        }
    }
}
