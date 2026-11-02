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
}
