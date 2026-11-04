import XCTest
@testable import JarvisCore

final class JarvisHealthChartValuesTests: XCTestCase {
    private let values = JarvisHealthChartValues(
        days: [
            JarvisHealthChartDay(date: "2026-10-29", value: 6),
            JarvisHealthChartDay(date: "2026-10-30", value: nil),
            JarvisHealthChartDay(date: "2026-10-31", value: 8),
        ],
        target: 8
    )

    func testAverageIgnoresDaysWithoutData() {
        XCTAssertEqual(values.average, 7)
    }

    func testAverageIsNilWithoutData() {
        let empty = JarvisHealthChartValues(
            days: [JarvisHealthChartDay(date: "2026-10-31", value: nil)], target: 8
        )
        XCTAssertNil(empty.average)
        XCTAssertFalse(empty.hasData)
        XCTAssertNil(empty.headline(selected: nil))
    }

    func testHeadlineIsTheAverageByDefault() {
        XCTAssertEqual(values.headline(selected: nil), 7)
        XCTAssertTrue(values.isShowingAverage(selected: nil))
    }

    func testHeadlineIsTheSelectedDay() {
        XCTAssertEqual(values.headline(selected: "2026-10-29"), 6)
        XCTAssertFalse(values.isShowingAverage(selected: "2026-10-29"))
        XCTAssertNil(values.headline(selected: "2026-10-30"))
    }

    func testUnknownSelectionFallsBackToTheAverage() {
        XCTAssertEqual(values.headline(selected: "2020-01-01"), 7)
        XCTAssertTrue(values.isShowingAverage(selected: "2020-01-01"))
    }

    func testTappingTheSelectedBarAgainReturnsToTheAverage() {
        XCTAssertEqual(JarvisHealthChartValues.toggled(selected: nil, tapped: "2026-10-29"), "2026-10-29")
        XCTAssertEqual(JarvisHealthChartValues.toggled(selected: "2026-10-29", tapped: "2026-10-31"), "2026-10-31")
        XCTAssertNil(JarvisHealthChartValues.toggled(selected: "2026-10-29", tapped: "2026-10-29"))
    }

    func testTargetIsKept() {
        XCTAssertEqual(values.target, 8)
    }

    func testSevenDayWindowEndsOnTheLastDayAndLeavesGapsEmpty() {
        let window = JarvisHealthChartValues(
            values: ["2026-11-01": 5, "2026-10-30": 7],
            endingOn: "2026-11-01", count: 7, target: nil
        )
        XCTAssertEqual(window.days.count, 7)
        XCTAssertEqual(window.days.first?.date, "2026-10-26")
        XCTAssertEqual(window.days.last?.date, "2026-11-01")
        XCTAssertEqual(window.days.compactMap(\.value), [7, 5])
        XCTAssertEqual(window.average, 6)
        XCTAssertNil(window.target)
    }

    func testGoalsDefaultToSensibleValuesAndRoundTrip() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "JarvisHealthGoalsTests"))
        suite.removePersistentDomain(forName: "JarvisHealthGoalsTests")
        XCTAssertEqual(JarvisHealthGoals.load(from: suite).sleepHours, 8)
        XCTAssertEqual(JarvisHealthGoals.load(from: suite), .defaults)
        var goals = JarvisHealthGoals.defaults
        goals.sleepHours = 7.5
        goals.carbsGrams = 200
        goals.save(to: suite)
        XCTAssertEqual(JarvisHealthGoals.load(from: suite), goals)
        suite.removePersistentDomain(forName: "JarvisHealthGoalsTests")
    }
}

final class JarvisHealthDayRowsTests: XCTestCase {
    func testSleepNightsReadStagesAndNeverInventMissingOnes() {
        let nights = JarvisHealthSleepNight.nights(from: [
            [
                "sleep_date": .string("2026-10-31"), "total_sleep_hours": .number(7.5),
                "deep_hours": .number(1.2), "rem_hours": .number(1.8),
                "core_hours": .number(4.5), "awake_hours": .number(0.4),
            ],
            ["sleep_date": .string("2026-10-30"), "asleep_hours": .number(6)],
            ["sleep_date": .string("2026-10-29"), "total_sleep_hours": .number(0)],
        ])
        XCTAssertEqual(nights["2026-10-31"]?.light, 4.5)
        XCTAssertEqual(nights["2026-10-31"]?.deep, 1.2)
        XCTAssertEqual(nights["2026-10-30"]?.total, 6)
        XCTAssertNil(nights["2026-10-30"]?.deep)
        XCTAssertNil(nights["2026-10-29"]?.total)
    }

    func testNutritionValuesSkipDaysWithoutMeals() {
        let values = JarvisHealthNutritionDays.values(from: [
            ["meal_date": .string("2026-10-31"), "meal_count": .number(2), "protein_grams": .number(120)],
            ["meal_date": .string("2026-10-30"), "meal_count": .number(0), "protein_grams": .number(0)],
            ["meal_date": .string("2026-10-29"), "meal_count": .number(1)],
        ], nutrient: .protein)
        XCTAssertEqual(values, ["2026-10-31": 120])
    }
}
