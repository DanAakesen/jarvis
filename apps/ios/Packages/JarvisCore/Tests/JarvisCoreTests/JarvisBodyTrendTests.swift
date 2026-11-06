import XCTest
@testable import JarvisCore

final class JarvisBodyTrendTests: XCTestCase {
    private let period = JarvisHealthPeriod(startDate: "2026-10-08", endDate: "2026-11-06")!

    private func row(_ day: String, _ value: Double, _ unit: String = "kg") -> [String: JSONValue] {
        ["metric_date": .string(day), "value": .number(value), "unit": .string(unit)]
    }

    func testSparseMeasurementsRetainDatesAndLatestValueBeforeAverage() {
        var latest = row("2026-11-01", 84)
        latest["avg_value"] = .number(83.5)
        let trend = JarvisBodyTrend(rows: [latest, row("2026-10-09", 85), row("2026-10-01", 86)], period: period)
        XCTAssertEqual(trend.readings.map(\.day), ["2026-10-09", "2026-11-01"])
        XCTAssertEqual(trend.readings.map(\.value), [85, 84])
        XCTAssertEqual(trend.latest?.value, 84)
        XCTAssertEqual(trend.nearest(to: trend.readings[0].date.addingTimeInterval(86_400))?.day, "2026-10-09")
    }

    func testMixedUnitsNeverShareTheLatestScaleAndInvalidValuesAreExcluded() {
        let trend = JarvisBodyTrend(rows: [row("2026-10-12", 185, "lb"), row("2026-10-25", 84),
            row("2026-10-32", 99), row("2026-11-01", .infinity), row("2026-11-02", 83, "")], period: period)
        XCTAssertEqual(trend.readings.count, 1)
        XCTAssertEqual(trend.latest?.unit, "kg")
        XCTAssertTrue(trend.excludesOtherUnits)
        XCTAssertEqual(trend.domain, 83...85)
    }

    func testEmptyAndSingleReadingDoNotAddZeroesOrInventALine() {
        let empty = JarvisBodyTrend(rows: [], period: period)
        XCTAssertNil(empty.latest)
        XCTAssertNil(empty.nearest(to: Date()))
        let one = JarvisBodyTrend(rows: [row("2026-10-25", 17, "%")], period: period)
        XCTAssertEqual(one.readings.count, 1)
        XCTAssertEqual(one.domain, 16...18)
        XCTAssertFalse(one.excludesOtherUnits)
    }
}
