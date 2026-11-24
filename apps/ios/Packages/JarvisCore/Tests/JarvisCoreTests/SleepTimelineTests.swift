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
}
