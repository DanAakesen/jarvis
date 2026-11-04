import XCTest
@testable import JarvisCore

final class JarvisNotesRecentTests: XCTestCase {
    private func node(_ name: String, _ date: String) -> KnowledgeGraphNode {
        KnowledgeGraphNode(
            id: name, path: "\(name).md", title: name, folder: "A", directory: "A",
            updatedAt: date, degree: 0, openTaskCount: nil
        )
    }

    func testRecentNotesAreNewestFirstAndLimited() {
        let nodes = (1...7).map { node("n\($0)", "2026-11-0\($0)T10:00:00Z") } + [node("bad", "nope")]
        XCTAssertEqual(JarvisNotesPresentation.recentNotes(nodes).map(\.title), ["n7", "n6", "n5", "n4", "n3"])
        XCTAssertEqual(JarvisNotesPresentation.recentNotes([node("bad", "x")]).count, 1)
        XCTAssertTrue(JarvisNotesPresentation.recentNotes([]).isEmpty)
    }

    func testRecentLabelHasBothLanguages() {
        XCTAssertEqual(JarvisNotesLocalization.string(.recent, language: .da), "Seneste")
        XCTAssertEqual(JarvisNotesLocalization.string(.recent, language: .en), "Recent")
    }
}
