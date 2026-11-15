import XCTest
@testable import JarvisCore

final class JarvisNotesRedesignTests: XCTestCase {
    private func note(_ content: String, sha: String = String(repeating: "a", count: 40)) throws -> VaultNote {
        let json = #"{"path":"Personal/x.md","content":\#(String(data: try JSONEncoder().encode(content), encoding: .utf8)!),"sha":"\#(sha)","url":"https://github.com/o/r"}"#
        return try JSONDecoder().decode(VaultNote.self, from: Data(json.utf8))
    }

    func testEditorPartsRoundTripKeepsPropertiesAndLineEndings() {
        let source = "---\ntags: [a]\n---\r\n# Moving plan\r\nKeep decisions.\r\n- [ ] Check the deed\r\n"
        let parts = JarvisNoteParts(source)
        XCTAssertEqual(parts.title, "Moving plan")
        XCTAssertEqual(parts.content, source)
        var edited = parts
        edited.title = "Moving plan 2"
        XCTAssertTrue(edited.content.hasPrefix("---\ntags: [a]\n---\r\n# Moving plan 2\r\n"))
        XCTAssertEqual(JarvisNoteParts("No heading\nText").title, nil)
        XCTAssertEqual(JarvisNoteParts("No heading\nText").content, "No heading\nText")
    }

    func testNewNoteGetsARealTitleHeading() {
        XCTAssertEqual(JarvisNoteParts(newTitle: " Plan ", body: "Body").content, "# Plan\n\nBody")
    }

    func testRecoveryNeverOverwritesANewerVersion() throws {
        let draft = "# T\n\nmine"
        let same = try note(draft)
        XCTAssertEqual(JarvisNoteSaveRecovery.decide(draft: draft, baselineSha: "x", latest: same), .alreadySaved)
        let unchanged = try note("# T\n\nold", sha: String(repeating: "b", count: 40))
        XCTAssertEqual(JarvisNoteSaveRecovery.decide(draft: draft, baselineSha: String(repeating: "b", count: 40), latest: unchanged), .writeAgain)
        XCTAssertEqual(JarvisNoteSaveRecovery.decide(draft: draft, baselineSha: String(repeating: "c", count: 40), latest: unchanged), .conflict)
    }

    func testPinReorderingMatchesOnMoveSemantics() {
        let pins = ["a", "b", "c", "d"]
        XCTAssertEqual(JarvisPinOrder.moved(pins, "c", by: -1), ["a", "c", "b", "d"])
        XCTAssertEqual(JarvisPinOrder.moved(pins, "a", by: -1), pins)
        XCTAssertEqual(JarvisPinOrder.moved(pins, from: IndexSet(integer: 0), to: 3), ["b", "c", "a", "d"])
        XCTAssertEqual(JarvisPinOrder.moved(pins, from: IndexSet(integer: 3), to: 0), ["d", "a", "b", "c"])
    }

    func testFolderPickerListsNestedFoldersAndSearchesThem() {
        let paths = ["Work", "Personal/Home", "Personal/Projects"]
        let collapsed = JarvisFolderPicker.rows(paths: paths, rootName: "Vault", expanded: [])
        XCTAssertEqual(collapsed.map(\.path), ["", "Personal", "Work"])
        let open = JarvisFolderPicker.rows(paths: paths, rootName: "Vault", expanded: ["Personal"])
        XCTAssertEqual(open.map(\.path), ["", "Personal", "Personal/Home", "Personal/Projects", "Work"])
        XCTAssertEqual(JarvisFolderPicker.rows(paths: paths, rootName: "Vault", expanded: [], query: "home").map(\.path), ["Personal/Home"])
    }

    func testInternalLinksResolveLikeTheVaultAndExternalOnesStayUntouched() throws {
        let paths: Set<String> = ["Personal/Home/Moving plan.md", "Personal/inbox.md"]
        XCTAssertEqual(JarvisNoteLinks.resolve("Moving plan|alias", from: "Personal/Home/a.md", paths: paths), "Personal/Home/Moving plan.md")
        XCTAssertEqual(JarvisNoteLinks.resolve("../inbox", from: "Personal/Home/a.md", paths: paths), "Personal/inbox.md")
        XCTAssertNil(JarvisNoteLinks.resolve("https://example.com", from: "a.md", paths: paths))
        let line = JarvisNoteLinks.rewriteInternalLinks("See [[Moving plan]] and [web](https://example.com)")
        XCTAssertTrue(line.contains("[Moving plan](jarvis-note:///Moving%20plan)"))
        XCTAssertTrue(line.contains("[web](https://example.com)"))
        XCTAssertEqual(JarvisNoteLinks.target(of: try XCTUnwrap(URL(string: "jarvis-note:///Moving%20plan"))), "Moving plan")
    }

    func testLineDiffMarksOnlyRealDifferences() throws {
        let rows = try XCTUnwrap(JarvisLineDiff.rows(latest: "a\nb\nc", draft: "a\nx\nc"))
        XCTAssertEqual(rows.map(\.kind), [.same, .removed, .added, .same])
        XCTAssertNil(JarvisLineDiff.rows(latest: "a", draft: "b", maximumLines: 0))
    }
}
