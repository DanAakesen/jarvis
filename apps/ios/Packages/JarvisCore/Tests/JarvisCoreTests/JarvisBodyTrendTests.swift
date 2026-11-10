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

    func testRefreshRetainsSelectedMeasurementWhenEarlierRowsAreBackfilled() {
        let selected = row("2026-10-25", 84)
        let previous = JarvisBodyTrend(rows: [selected, row("2026-11-01", 83)], period: period)
        let refreshed = JarvisBodyTrend(
            rows: [row("2026-10-09", 85), selected, row("2026-11-01", 83)], period: period
        )

        let selection = refreshed.selectionID(retaining: previous.readings.first?.id, from: previous)
        XCTAssertEqual(selection, 1)
        XCTAssertEqual(refreshed.readings.first { $0.id == selection }?.day, "2026-10-25")
        XCTAssertEqual(refreshed.readings.first { $0.id == selection }?.value, 84)
    }

    func testRefreshRetainsSelectedMeasurementWhenRowsAreReordered() {
        let first = row("2026-10-25", 84)
        let second = row("2026-11-01", 83)
        let previous = JarvisBodyTrend(rows: [first, second], period: period)
        let refreshed = JarvisBodyTrend(rows: [second, first], period: period)

        XCTAssertEqual(refreshed.selectionID(retaining: 0, from: previous), 1)
        XCTAssertNil(refreshed.selectionID(retaining: nil, from: previous))
        XCTAssertNil(refreshed.selectionID(retaining: 99, from: previous))
    }

    func testRefreshDropsSelectionWhenPositionIsReusedForAnotherMeasurement() {
        let previous = JarvisBodyTrend(rows: [row("2026-10-25", 84)], period: period)
        for replacement in [
            row("2026-10-26", 84), row("2026-10-25", 83), row("2026-10-25", 84, "lb"),
        ] {
            let refreshed = JarvisBodyTrend(rows: [replacement], period: period)
            XCTAssertNil(refreshed.selectionID(retaining: 0, from: previous))
        }
        XCTAssertNil(JarvisBodyTrend(rows: [], period: period).selectionID(retaining: 0, from: previous))
    }

    func testUnchangedRefreshKeepsSelectionAndLatestMode() {
        let trend = JarvisBodyTrend(rows: [row("2026-10-25", 84), row("2026-11-01", 83)], period: period)
        XCTAssertEqual(trend.selectionID(retaining: 0, from: trend), 0)
        XCTAssertNil(trend.selectionID(retaining: nil, from: trend))
    }
}
