import Foundation
import XCTest
@testable import JarvisCore

final class JarvisDailyActivityTests: XCTestCase {
    let now = ISO8601DateFormatter().date(from: "2026-11-02T13:30:00Z")!
    func testMissingAndTrueZeroAreDistinct() {
        let period = JarvisHealthPeriod.make(.today, now: now)
        let missing = JarvisDailyActivitySnapshot(days: [:], fetchedAt: now)
        XCTAssertNil(missing.total(\.activeKilocalories, period: period, now: now).value)
        let zero = JarvisDailyActivitySnapshot(days: ["2026-11-02":
            JarvisDailyActivityDay(activeKilocalories: 0, exerciseMinutes: 0, observedAt: now)], fetchedAt: now)
        XCTAssertEqual(zero.total(\.activeKilocalories, period: period, now: now).value, 0)
        XCTAssertEqual(zero.total(\.exerciseMinutes, period: period, now: now).availability, .available)
    }
    func testNoWorkoutsStillHasActiveEnergyAndExerciseAndHomeHealthParityForEveryPeriod() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.dateFormat = "yyyy-MM-dd"
        var days: [String: JarvisDailyActivityDay] = [:]
        for offset in 0..<30 {
            let date = calendar.date(byAdding: .day, value: -offset, to: now)!
            days[format.string(from: date)] = JarvisDailyActivityDay(activeKilocalories: 100, exerciseMinutes: 12, observedAt: now)
        }
        let snapshot = JarvisDailyActivitySnapshot(days: days, fetchedAt: now)
        for range in JarvisTodayRange.allCases {
            let display = JarvisTodayActivityDisplay(state: JarvisTodayActivityState(range: range),
                workouts: [], steps: .empty, dailyActivity: snapshot, now: now, language: .en, calendar: calendar)
            let end = JarvisHealthPeriod.make(.today, now: now).endDate
            let start = format.string(from: calendar.date(byAdding: .day, value: -(range.dayCount - 1), to: now)!)
            let period = JarvisHealthPeriod(startDate: start, endDate: end)!
            XCTAssertEqual(display.totalWorkouts, 0)
            XCTAssertEqual(display.energyTotal, snapshot.total(\.activeKilocalories, period: period, now: now))
            XCTAssertEqual(display.activeKilocalories, range.dayCount * 100)
            XCTAssertEqual(display.activeMinutes, range.dayCount * 12)
            XCTAssertEqual(display.energyTotal.availability, .available)
        }
    }
    func testRepeatSyncReplacesRatherThanAddsAndMissingRetainedReadingIsStale() {
        let server = JarvisDailyActivitySnapshot(days: ["2026-11-02":
            JarvisDailyActivityDay(activeKilocalories: 200, exerciseMinutes: 20, observedAt: now)], fetchedAt: now)
        let local = JarvisDailyActivitySnapshot(days: ["2026-11-02":
            JarvisDailyActivityDay(activeKilocalories: 250, exerciseMinutes: 25, observedAt: now)], fetchedAt: now)
        let once = server.merging(local: local)
        XCTAssertEqual(once, once.merging(local: local))
        XCTAssertEqual(once.days["2026-11-02"]?.activeKilocalories, 250)
        let stale = server.merging(local: JarvisDailyActivitySnapshot(days: [:], fetchedAt: now))
        XCTAssertEqual(stale.total(\.activeKilocalories, period: .make(.today, now: now), now: now).availability, .stale)
        XCTAssertEqual(local.total(\.activeKilocalories, period: .make(.sevenDays, now: now), now: now).availability, .partial)
    }
    func testServerRejectsRawOverlapAndDeduplicatesAliasesWithLateUpdates() {
        func row(_ metric: String, _ value: Double, merged: Bool, updated: String) -> [String: JSONValue] {
            ["metric_name": .string(metric), "metric_date": .string("2026-11-02"),
             "unit": .string("kcal"), "value": .number(value),
             "fields": .object(["mergedDailyTotal": .bool(merged)]), "updated_at": .string(updated)]
        }
        let rows = [
            row("active_energy", 900, merged: true, updated: "2026-11-02T13:30:00Z"),
            row("active_energy_burned", 200, merged: true, updated: "2026-11-02T13:20:00Z"),
            row("active_energy_burned", 250, merged: true, updated: "2026-11-02T13:30:00Z"),
            row("active_energy_burned", 999, merged: false, updated: "2026-11-02T13:31:00Z"),
        ]
        let snapshot = JarvisDailyActivitySnapshot.server(rows: rows, fetchedAt: now)
        XCTAssertEqual(snapshot.days["2026-11-02"]?.activeKilocalories, 250)
        XCTAssertNil(snapshot.days["2026-11-02"]?.exerciseMinutes)
        XCTAssertEqual(snapshot, JarvisDailyActivitySnapshot.server(rows: Array(rows.reversed()), fetchedAt: now))
        XCTAssertEqual(snapshot.total(\.activeKilocalories, period: .make(.today, now: now), now: now).availability, .available)
        XCTAssertEqual(snapshot.total(\.activeKilocalories, period: .make(.today, now: now),
            now: now.addingTimeInterval(901)).availability, .stale)
    }

    func testFreshExerciseCannotHideStaleEnergyAndFutureReadingsAreNotFresh() {
        let rows: [[String: JSONValue]] = [
            ["metric_name": .string("active_energy_burned"), "metric_date": .string("2026-11-02"),
             "unit": .string("kcal"), "value": .number(200), "fields": .object(["mergedDailyTotal": .bool(true)]),
             "updated_at": .string("2026-11-02T12:00:00Z")],
            ["metric_name": .string("apple_exercise_time"), "metric_date": .string("2026-11-02"),
             "unit": .string("min"), "value": .number(20), "fields": .object(["mergedDailyTotal": .bool(true)]),
             "updated_at": .string("2026-11-02T13:30:00Z")],
        ]
        let snapshot = JarvisDailyActivitySnapshot.server(rows: rows, fetchedAt: now)
        XCTAssertEqual(snapshot.total(\.activeKilocalories, period: .make(.today, now: now), now: now).availability, .stale)
        var future = rows[0]
        future["updated_at"] = .string("2026-11-02T14:30:00Z")
        XCTAssertEqual(JarvisDailyActivitySnapshot.server(rows: [future], fetchedAt: now)
            .total(\.activeKilocalories, period: .make(.today, now: now), now: now).availability, .stale)
    }

}
