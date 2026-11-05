import XCTest
@testable import JarvisCore

final class JarvisNotesBrowsingTests: XCTestCase {
    func testRootIncludesFoldersWithOnlyNestedOrAttachmentContent() {
        let paths = ["Work/Projects/2026", "Personal", "Attachments/Scans", ".hidden", "Work"]
        XCTAssertEqual(JarvisNotesPresentation.childFolders(in: "", paths: paths).map(\.path), ["Attachments", "Personal", "Work"])
        XCTAssertEqual(JarvisNotesPresentation.childFolders(in: "Work", paths: paths).map(\.path), ["Work/Projects"])
        XCTAssertEqual(JarvisNotesPresentation.childFolders(in: "Work/Projects", paths: paths).map(\.path), ["Work/Projects/2026"])
    }

    func testBackReturnsOneLevelAndStopsAtRoot() {
        XCTAssertEqual(JarvisNotesPresentation.parentFolder(of: "Work/Projects/2026"), "Work/Projects")
        XCTAssertEqual(JarvisNotesPresentation.parentFolder(of: "Work"), "")
        XCTAssertNil(JarvisNotesPresentation.parentFolder(of: ""))
    }

    func testNewFolderStaysInsideTheSelectedSubfolder() {
        XCTAssertEqual(JarvisNotesPresentation.newFolderPath(named: "  Research  ", in: "Work/Projects"), "Work/Projects/Research")
        XCTAssertEqual(JarvisNotesLogic.notePath(folder: "Work/Projects/Research", title: "First note"), "Work/Projects/Research/first-note.md")
        for name in ["", "../Personal", "New/Child", ".hidden", ".."] {
            XCTAssertNil(JarvisNotesPresentation.newFolderPath(named: name, in: "Work/Projects"))
        }
    }

    func testRootCountAndRowsExcludeNestedNotes() {
        let notes = [note("root.md", directory: ""), note("Work/nested.md", directory: "Work")]
        let visible = JarvisNotesPresentation.directoryNotes(notes, in: "")
        XCTAssertEqual(visible.count, 1)
        XCTAssertEqual(visible.map(\.path), ["root.md"])
    }

    func testRecentUsesSuccessfulOpenTimeRatherThanModificationTime() {
        let graph = KnowledgeGraph(nodes: [node("old.md", updatedAt: "2020-01-01T00:00:00Z"), node("new.md", updatedAt: "2026-11-05T00:00:00Z")], edges: [], updatedAt: "2026-11-05T00:00:00Z", openTaskNoteCount: nil, taskCountsPartial: nil)
        let visits = [JarvisNoteVisit(path: "old.md", openedAt: Date(timeIntervalSince1970: 20)), JarvisNoteVisit(path: "new.md", openedAt: Date(timeIntervalSince1970: 10)), JarvisNoteVisit(path: "deleted.md", openedAt: Date(timeIntervalSince1970: 30))]
        XCTAssertEqual(JarvisNotesPresentation.recentlyOpenedNotes(graph, visits: visits).map(\.path), ["old.md", "new.md"])
        XCTAssertTrue(JarvisNotesPresentation.recentlyOpenedNotes(graph, visits: []).isEmpty)
    }

    func testReadingHistorySurvivesRefreshButIsClearedOnSignOut() async {
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage())
        await cache.bind(account: "test-owner")
        await cache.recordNoteOpen(path: "Work/first.md", at: Date(timeIntervalSince1970: 10))
        await cache.recordNoteOpen(path: "Work/first.md", at: Date(timeIntervalSince1970: 20))
        await cache.invalidateAll(kind: .notes)
        let visits = await cache.recentNoteVisits()
        XCTAssertEqual(visits, [JarvisNoteVisit(path: "Work/first.md", openedAt: Date(timeIntervalSince1970: 20))])
        await cache.clear()
        await cache.bind(account: "test-owner")
        let cleared = await cache.recentNoteVisits()
        XCTAssertTrue(cleared.isEmpty)
    }

    private func note(_ path: String, directory: String) -> VaultNoteSummary {
        VaultNoteSummary(path: path, title: path, folder: directory, directory: directory, updatedAt: "2026-11-05T00:00:00Z")
    }

    private func node(_ path: String, updatedAt: String) -> KnowledgeGraphNode {
        KnowledgeGraphNode(id: path, path: path, title: path, folder: "", directory: "", updatedAt: updatedAt, degree: 0, openTaskCount: nil)
    }
}
