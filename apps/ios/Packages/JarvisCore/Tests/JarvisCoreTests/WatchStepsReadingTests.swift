import Foundation
import XCTest
@testable import JarvisCore

final class WatchStepsReadingTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        return calendar
    }
    private func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }
    private func phone(steps: Int?, at now: Date) -> WatchHealthSnapshot {
        var snapshot = WatchHealthSnapshot(now: now, calendar: calendar)
        snapshot.steps = steps
        snapshot.hourlySteps = steps.map { [$0] }
        snapshot.stepGoal = 8_000
        snapshot.tasksToday = 3
        return snapshot
    }

    func testReadingSumsHoursAndIgnoresNegativeValues() {
        let reading = WatchStepsReading(measuredAt: date(15, 10), hourly: [0, 120, -5, 300])
        XCTAssertEqual(reading.steps, 420)
        XCTAssertEqual(reading.hourly, [0, 120, 0, 300])
    }

    func testNoHealthKitQuantitiesIsUnavailableNotZero() {
        XCTAssertNil(WatchStepsReading(measuredAt: date(15, 8), hourlySums: [nil, nil, nil]))
        XCTAssertNil(WatchStepsReading(measuredAt: date(15, 8), hourlySums: []))
        let reading = WatchStepsReading(measuredAt: date(15, 8), hourlySums: [nil, 120.4, nil, 30])
        XCTAssertEqual(reading?.hourly, [0, 120, 0, 30])
        XCTAssertEqual(WatchStepsReading(measuredAt: date(15, 8), hourlySums: [0.0])?.steps, 0, "a real zero sum is a measurement")
    }

    func testReadingNeverCreatesASnapshotAfterSignOut() {
        let reading = WatchStepsReading(measuredAt: date(15, 12), hourly: [4_000])
        XCTAssertNil(WatchHealthSnapshot.applying(reading, to: nil, calendar: calendar))
        let signedIn = phone(steps: 100, at: date(15, 11))
        XCTAssertEqual(WatchHealthSnapshot.applying(reading, to: signedIn, calendar: calendar)?.steps, 4_000)
    }

    func testWatchReadingNewerThanHoursOldPhoneSnapshotUpdatesStepsOnly() {
        let old = phone(steps: 1_000, at: date(15, 6))
        let updated = old.applying(.init(measuredAt: date(15, 18), hourly: [2_000, 3_000]), calendar: calendar)
        XCTAssertEqual(updated.steps, 5_000)
        XCTAssertEqual(updated.stepsAsOf, date(15, 18))
        XCTAssertEqual(updated.generatedAt, old.generatedAt, "the phone push keeps its own age so the phone is still asked to refresh")
        XCTAssertEqual(updated.tasksToday, 3)
        XCTAssertEqual(updated.stepGoal, 8_000)
    }

    func testLowerWatchReadingNeverReplacesHigherSteps() {
        let old = phone(steps: 6_000, at: date(15, 17))
        XCTAssertEqual(old.applying(.init(measuredAt: date(15, 18), hourly: [5_000]), calendar: calendar), old)
    }

    func testEqualReadingRefreshesAge() {
        let old = phone(steps: 5_000, at: date(15, 6))
        let updated = old.applying(.init(measuredAt: date(15, 18), hourly: [5_000]), calendar: calendar)
        XCTAssertEqual(updated.stepsAsOf, date(15, 18))
        XCTAssertTrue(updated.stepsAreCurrent(at: date(15, 18, 5), calendar: calendar))
    }

    func testFirstReadingOfANewDayDropsYesterdaysDailyValuesButKeepsGoals() {
        var old = phone(steps: 9_000, at: date(15, 22))
        old.dailyKcal = 400
        let updated = old.applying(.init(measuredAt: date(16, 7), hourly: [0, 0, 0, 0, 0, 0, 0, 250]), calendar: calendar)
        XCTAssertEqual(updated.steps, 250)
        XCTAssertEqual(updated.dayStart, calendar.startOfDay(for: date(16, 7)))
        XCTAssertEqual(updated.stepGoal, 8_000)
        XCTAssertNil(updated.tasksToday)
        XCTAssertNil(updated.dailyKcal)
    }

    func testReadingFromAnEarlierDayIsIgnored() {
        let old = phone(steps: 100, at: date(16, 7))
        XCTAssertEqual(old.applying(.init(measuredAt: date(15, 23), hourly: [9_999]), calendar: calendar), old)
    }

    func testStepsAreHonestAboutAge() {
        var snapshot = phone(steps: 4_000, at: date(15, 9))
        XCTAssertTrue(snapshot.stepsAreCurrent(at: date(15, 9, 19), calendar: calendar))
        XCTAssertFalse(snapshot.stepsAreCurrent(at: date(15, 9, 20), calendar: calendar))
        XCTAssertEqual(snapshot.stepsExpireAt(calendar: calendar), date(15, 9, 20))
        snapshot.stepsAt = date(15, 9, 30)
        XCTAssertTrue(snapshot.stepsAreCurrent(at: date(15, 9, 45), calendar: calendar))
        XCTAssertFalse(snapshot.stepsAreCurrent(at: date(16, 0, 5), calendar: calendar))
        snapshot.steps = nil
        XCTAssertFalse(snapshot.stepsAreCurrent(at: date(15, 9, 31), calendar: calendar))
    }

    func testStepsExpireAtMidnightWhenSooner() {
        let snapshot = phone(steps: 4_000, at: date(15, 23, 55))
        XCTAssertEqual(snapshot.stepsExpireAt(calendar: calendar), date(16, 0))
    }

    func testPhonePushDoesNotRollBackHigherWatchSteps() {
        var local = phone(steps: 5_000, at: date(15, 6)).applying(.init(measuredAt: date(15, 12), hourly: [5_000]), calendar: calendar)
        local.hourlySteps = [5_000]
        let incoming = phone(steps: 3_000, at: date(15, 12, 5))
        let merged = incoming.keepingHigherSteps(from: local, calendar: calendar)
        XCTAssertEqual(merged.steps, 5_000)
        XCTAssertEqual(merged.stepsAsOf, date(15, 12))
        XCTAssertEqual(merged.generatedAt, incoming.generatedAt)
    }

    func testPhonePushWithMoreStepsWinsAndMissingStepsKeepWatchValue() {
        let local = phone(steps: 5_000, at: date(15, 12))
        let higher = phone(steps: 6_000, at: date(15, 13)).keepingHigherSteps(from: local, calendar: calendar)
        XCTAssertEqual(higher.steps, 6_000)
        XCTAssertEqual(higher.stepsAsOf, date(15, 13))
        let missing = phone(steps: nil, at: date(15, 13)).keepingHigherSteps(from: local, calendar: calendar)
        XCTAssertEqual(missing.steps, 5_000)
    }

    func testPhonePushFromANewDayNeverInheritsYesterdaysSteps() {
        let local = phone(steps: 9_000, at: date(15, 22))
        let incoming = phone(steps: 10, at: date(16, 6))
        XCTAssertEqual(incoming.keepingHigherSteps(from: local, calendar: calendar).steps, 10)
    }

    func testOlderSnapshotsWithoutStepsAtStillDecode() throws {
        let snapshot = phone(steps: 1, at: date(15, 6))
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as! [String: Any]
        object["stepsAt"] = nil
        let data = try JSONSerialization.data(withJSONObject: object)
        let decoded = try JSONDecoder().decode(WatchHealthSnapshot.self, from: data)
        XCTAssertNil(decoded.stepsAt)
        XCTAssertEqual(decoded.stepsAsOf, decoded.generatedAt)
    }
}
