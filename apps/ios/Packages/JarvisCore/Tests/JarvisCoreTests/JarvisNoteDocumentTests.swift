import XCTest
@testable import JarvisCore

final class JarvisNoteDocumentTests: XCTestCase {
    func testFormattedProjectionPreservesEveryByteUntilEdited() {
        for source in ["", "---\nscope: personal\nprivate: true\n---\n# Ella\n\n- Likes **sushi**.\n",
                       "---\r\ntype: person\r\n---\r\n# Title\r\n- [ ] Task\r\n",
                       "```yaml\n# not a heading\n- [ ] not a task\n```\n[link][reference]\n",
                       "---\nnot closed", "| Table | Value |\n| --- | --- |\n| one | two |"] {
            XCTAssertEqual(JarvisNoteDocument(source).markdown, source)
        }
    }

    func testEditingAndCheckingLeaveMetadataAndUnrelatedContentUntouched() {
        let source = "---\r\nprivate: true\r\n---\r\n# Ella\r\n\r\n- [ ] Sushi\r\n<custom>untouched</custom>"
        var document = JarvisNoteDocument(source)
        document.blocks[2].toggleCheck()
        document.blocks[2].text = "Sushi dinner"
        XCTAssertEqual(document.markdown, source.replacingOccurrences(of: "- [ ] Sushi", with: "- [x] Sushi dinner"))
        XCTAssertEqual(document.metadata, "---\r\nprivate: true\r\n---\r\n")
    }

    func testCodeFencesAreNeverTurnedIntoInteractiveTasks() {
        let document = JarvisNoteDocument("```md\n- [ ] example\n```\n- [x] real")
        XCTAssertFalse(document.blocks[1].isChecklist)
        XCTAssertTrue(document.blocks[3].isChecked)
    }

    func testAppendingPreservesExistingLineEndingsAndAddsEditableBlock() {
        var document = JarvisNoteDocument("# A\r\ntext")
        let id = document.append(prefix: "- [ ] ", text: "New item")
        XCTAssertEqual(document.blocks.last?.id, id)
        XCTAssertEqual(document.markdown, "# A\r\ntext\r\n- [ ] New item")
    }

    func testPinsSurviveRefreshAndStayAccountBound() async {
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage())
        await cache.bind(account: "owner")
        await cache.setNotePinned(path: "Personal/one.md", pinned: true)
        await cache.setNotePinned(path: "Personal/one.md", pinned: true)
        await cache.setNotePinned(path: "../bad.md", pinned: true)
        await cache.invalidateAll(kind: .notes)
        let paths = await cache.pinnedNotePaths()
        XCTAssertEqual(paths, ["Personal/one.md"])
        await cache.setNotePinned(path: "Personal/one.md", pinned: false)
        let empty = await cache.pinnedNotePaths()
        XCTAssertTrue(empty.isEmpty)
        await cache.setNotePinned(path: "Personal/one.md", pinned: true)
        await cache.bind(account: "other")
        let other = await cache.pinnedNotePaths()
        XCTAssertTrue(other.isEmpty)
    }
}
