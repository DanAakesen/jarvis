import XCTest
@testable import JarvisCore

final class SleepTimelineTests: XCTestCase {
    func testChartAndTotalsUseTheSameNonoverlappingIntervals() {
        let start = Date(timeIntervalSince1970: 0)
        func segment(_ stage: String, _ from: Int, _ to: Int) -> JarvisHealthSleepSegment {
            .init(id: "\(stage)-\(from)", stage: stage, start: start.addingTimeInterval(Double(from) * 60),
                  end: start.addingTimeInterval(Double(to) * 60))
        }
        let timeline = JarvisSleepTimeline(segments: [
            segment("awake", 90, 100), segment("core", 0, 60), segment("core", 30, 60),
            segment("rem", 55, 85), segment("deep", 110, 110)
        ])
        let row = timeline.dailyRow(date: "2026-11-24")
        XCTAssertEqual(timeline.segments.count, 3)
        XCTAssertEqual(row?["core_hours"], .number(1))
        XCTAssertEqual(row?["rem_hours"], .number(25.0 / 60))
        XCTAssertEqual(row?["awake_hours"], .number(10.0 / 60))
        XCTAssertEqual(row?["total_sleep_hours"], .number(1 + 25.0 / 60))
        XCTAssertNil(row?["deep_hours"])
        XCTAssertNil(JarvisSleepTimeline(segments: []).dailyRow(date: "2026-11-24"))
    }

    func testOvernightExcludesPriorAfternoonAndOverlappingSecondSource() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let midnight = Date(timeIntervalSince1970: 24 * 3600)
        func sample(_ id: String, _ source: String, _ start: Int, _ end: Int) -> JarvisHealthSleepSegment {
            .init(id: id, stage: "core", start: midnight.addingTimeInterval(Double(start) * 3600),
                  end: midnight.addingTimeInterval(Double(end) * 3600), source: source)
        }
        let nap = sample("nap", "watch", -9, -8)
        let overnight = sample("night", "watch", -1, 6)
        let shorter = sample("duplicate", "phone", 0, 4)
        let result = JarvisSleepTimeline.overnight([nap, shorter, overnight], wakingOn: midnight, calendar: calendar)
        XCTAssertEqual(result.segments, [overnight])
        XCTAssertTrue(JarvisSleepTimeline.overnight([nap], wakingOn: midnight, calendar: calendar).segments.isEmpty)
    }

    func testUnclassifiedSleepFillsOnlyGapsAndRetainsACompleteSummary() {
        let start = Date(timeIntervalSince1970: 0)
        func sample(_ stage: String, _ from: Int, _ to: Int) -> JarvisHealthSleepSegment {
            .init(id: stage, stage: stage, start: start.addingTimeInterval(Double(from) * 3600),
                  end: start.addingTimeInterval(Double(to) * 3600))
        }
        let night = JarvisSleepTimeline(segments: [sample("asleep", 0, 8), sample("core", 1, 5), sample("awake", 5, 6)])
        XCTAssertEqual(night.stagedHours, 4)
        XCTAssertEqual(night.dailyRow(date: "2026-11-24")?["total_sleep_hours"], .number(7))
        XCTAssertEqual(night.dailyRow(date: "2026-11-24", retainedTotal: 8)?["total_sleep_hours"], .number(8))
    }
}
