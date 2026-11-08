import XCTest
@testable import JarvisCore

final class JarvisNoteLibraryTests: XCTestCase {
    private func node(_ path: String, _ date: String) -> KnowledgeGraphNode {
        KnowledgeGraphNode(id: path, path: path, title: path, folder: "Personal",
                           directory: "Personal", updatedAt: date, degree: 0, openTaskCount: nil)
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    func testOpenAndModifiedRecencyUseLatestValueWithStableTies() {
        let nodes = [
            node("b.md", "2026-11-08T09:00:00.000Z"),
            node("a.md", "2026-11-08T09:00:00Z"),
            node("opened.md", "2026-10-01T00:00:00Z"),
            node("invalid.md", "unknown")
        ]
        let visits = [
            JarvisNoteVisit(path: "opened.md", openedAt: date("2026-11-08T10:00:00Z")),
            JarvisNoteVisit(path: "opened.md", openedAt: date("2026-10-02T00:00:00Z")),
            JarvisNoteVisit(path: "missing.md", openedAt: date("2026-11-08T11:00:00Z")),
            JarvisNoteVisit(path: "b.md", openedAt: date("2026-10-02T00:00:00Z"))
        ]
        let result = JarvisNotesPresentation.libraryGroups(
            nodes: nodes, visits: visits, now: date("2026-11-08T12:00:00Z"), calendar: utc
        )
        XCTAssertEqual(result.map(\.period), [.today, .earlier])
        XCTAssertEqual(result[0].notes.map(\.path), ["opened.md", "a.md", "b.md"])
        XCTAssertEqual(result[1].notes.map(\.path), ["invalid.md"])
    }

    func testCalendarDayBucketsRespectTimeZoneAndDaylightSaving() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        // DST has ended. The previous local calendar day was 25 hours long.
        let result = JarvisNotesPresentation.libraryGroups(nodes: [
            node("today.md", "2026-11-02T08:15:00Z"),
            node("yesterday.md", "2026-11-01T07:30:00Z"),
            node("earlier.md", "2026-11-01T06:30:00Z")
        ], visits: [], now: date("2026-11-02T08:30:00Z"), calendar: calendar)
        XCTAssertEqual(result.map(\.period), [.today, .yesterday, .earlier])
        XCTAssertEqual(result.map { $0.notes.map(\.path) },
                       [["today.md"], ["yesterday.md"], ["earlier.md"]])
    }

    func testLargeInventoryKeepsEveryNoteAndInvalidDates() {
        let nodes = (0..<1003).map { index in
            node("Personal/n\(index).md", index.isMultiple(of: 7) ? "invalid" : "2026-11-07T10:00:00Z")
        }
        let result = JarvisNotesPresentation.libraryGroups(
            nodes: nodes, visits: [], now: date("2026-11-08T12:00:00Z"), calendar: utc
        )
        let allPaths = result.flatMap(\.notes).map(\.path)
        XCTAssertEqual(allPaths.count, 1003)
        XCTAssertEqual(Set(allPaths), Set(nodes.map(\.path)))
        XCTAssertEqual(result.map(\.period), [.yesterday, .earlier])
        XCTAssertEqual(result[1].notes.count, 144)
    }

    func testEmptyInventoryDoesNotCreateEmptySectionsFromVisits() {
        let result = JarvisNotesPresentation.libraryGroups(nodes: [], visits: [
            JarvisNoteVisit(path: "gone.md", openedAt: Date())
        ])
        XCTAssertTrue(result.isEmpty)
    }
}
