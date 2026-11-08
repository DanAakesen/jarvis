import XCTest
@testable import JarvisCore

final class NowFeedActivityGroupingTests: XCTestCase {
    private func item(_ id: String, _ category: NowFeedActivityCategory, _ at: String) -> NowFeedActivityItem {
        NowFeedActivityItem(id: id, category: category, title: "t\(id)", link: nil, at: at)
    }

    func testManyNotificationsCollapseToOneRowPerCategoryShowingTheLatest() {
        let items = (1...100).map { item("\($0)", .alert, String(format: "2026-11-02T10:%02d:00Z", $0 % 60)) }
            + [item("a", .attention, "2026-11-02T09:00:00Z")]
        let groups = NowFeedActivityGrouping.groups(items)
        XCTAssertEqual(groups.map(\.category), [.attention, .alert])
        XCTAssertEqual(groups[1].items.count, 100)
        XCTAssertEqual(groups[1].olderCount, 99)
        XCTAssertEqual(groups[1].latest.at, "2026-11-02T10:59:00Z")
        XCTAssertEqual(groups[0].olderCount, 0)
    }

    func testFractionalSecondsAndUnreadableTimesSortSafely() {
        let groups = NowFeedActivityGrouping.groups([
            item("x", .alert, "not a time"),
            item("old", .alert, "2026-11-02T10:00:00Z"),
            item("new", .alert, "2026-11-02T10:00:00.500Z"),
        ])
        XCTAssertEqual(groups[0].items.map(\.id), ["new", "old", "x"])
    }

    func testEmptyFeedHasNoGroups() {
        XCTAssertTrue(NowFeedActivityGrouping.groups([]).isEmpty)
    }

    func testTaskNavigationUsesOnlyAValidTypedLink() {
        for (link, expected) in [("task:23", "23"), ("task:9223372036854775807", "9223372036854775807"),
                                 ("task:0", nil), ("task:23/controls", nil), ("task:9223372036854775808", nil),
                                 ("https://example.invalid/task:23", nil), ("release:23", nil), ("task:023", nil)] {
            let notification = NowFeedActivityItem(
                id: "1", category: .alert, title: "Task 23 is running", link: link, at: "2026-11-08T12:00:00Z"
            )
            XCTAssertEqual(notification.factoryTaskID, expected, link)
        }
        XCTAssertNil(item("1", .alert, "2026-11-08T12:00:00Z").factoryTaskID)
    }
}
