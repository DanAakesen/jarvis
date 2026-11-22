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

    func testBodyAddedAfterAnUnterminatedTitleStartsOnItsOwnLine() {
        var parts = JarvisNoteParts("# Title")
        XCTAssertEqual(parts.content, "# Title")
        parts.body = "Body"
        XCTAssertEqual(parts.content, "# Title\nBody")
    }

    func testRenamingAHeadinglessNotePreservesItsFirstLineAndProperties() {
        let path = "Personal/weekend-plan.md"
        let properties = "---\r\ntags: [personal]\r\n---\r\n"
        let body = "The first line belongs to the body.\r\n\r\n# A later section\r\n- [ ] Pack"
        let parts = JarvisNoteParts(properties + body)
        XCTAssertEqual(parts.displayedTitle(path: path), "Weekend plan")
        XCTAssertEqual(parts.content(editedTitle: "Weekend plan", path: path), properties + body)

        let renamed = parts.content(editedTitle: "  Packing list  ", path: path)
        XCTAssertEqual(renamed, properties + "# Packing list\r\n\r\n" + body)
        XCTAssertEqual(JarvisNoteTitle.title(content: renamed, path: path), "Packing list")
        XCTAssertEqual(JarvisNoteParts(renamed).readableBody.trimmingCharacters(in: .newlines), body)
    }

    func testRenamingAnExistingHeadingChangesOnlyTheHeading() {
        let path = "old-name.md"
        let parts = JarvisNoteParts("\n# Original title\n\nBody")
        XCTAssertEqual(parts.displayedTitle(path: path), "Original title")
        XCTAssertEqual(parts.content(editedTitle: "New title", path: path), "\n# New title\n\nBody")
        XCTAssertEqual(parts.content(editedTitle: " ", path: path), parts.content)
    }

    func testRenamingAHeadinglessNoteDoesNotAddAnotherBlankLine() {
        let properties = "---\r\nflag: true\r\n---\r\n"
        for body in ["\r\nOriginal body", " \t\r\nOriginal body", "\r\n\r\nOriginal body"] {
            let source = properties + body
            let renamed = JarvisNoteParts(source).content(editedTitle: "New title", path: "old-name.md")
            XCTAssertEqual(renamed, properties + "# New title\r\n" + body)
            XCTAssertEqual(JarvisNoteParts(renamed).readableBody, body)
        }
    }

    func testEditingOnlyTheBodyDoesNotPromoteTheFallbackTitle() {
        var parts = JarvisNoteParts("Original body")
        parts.body = "New body"
        XCTAssertEqual(parts.content(editedTitle: "Old name", path: "old-name.md"), "New body")
        XCTAssertEqual(
            JarvisNoteParts("---\nflag: true\n---").content(editedTitle: "New title", path: "old-name.md"),
            "---\nflag: true\n---\n# New title"
        )
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
        XCTAssertEqual(JarvisManualOrder.moved(pins, "c", by: -1), ["a", "c", "b", "d"])
        XCTAssertEqual(JarvisManualOrder.moved(pins, "a", by: -1), pins)
        XCTAssertEqual(JarvisManualOrder.moved(pins, from: IndexSet(integer: 0), to: 3), ["b", "c", "a", "d"])
        XCTAssertEqual(JarvisManualOrder.moved(pins, from: IndexSet(integer: 3), to: 0), ["d", "a", "b", "c"])
    }

    func testManualFolderOrderPutsListedFoldersFirstAndNewOnesLast() {
        let folders = JarvisNotesPresentation.childFolders(in: "", paths: ["Archive", "General", "Personal", "Work", "Ideas"])
        var order = JarvisFolderOrder()
        XCTAssertEqual(order.ordered(folders, in: "").map(\.path), ["Archive", "General", "Ideas", "Personal", "Work"])
        // "Gone" was deleted or renamed; "Archive" and "Ideas" are new since the order was saved.
        order.set(["Work", "Personal", "Gone", "General"], in: "")
        XCTAssertEqual(order.ordered(folders, in: "").map(\.path), ["Work", "Personal", "General", "Archive", "Ideas"])
        order.set([], in: "")
        XCTAssertEqual(order.ordered(folders, in: "").map(\.path), ["Archive", "General", "Ideas", "Personal", "Work"])
    }

    func testManualFolderOrderIsPerParent() {
        let nested = JarvisNotesPresentation.childFolders(in: "Work", paths: ["Work/A", "Work/B", "Work/C", "Personal/X"])
        var order = JarvisFolderOrder()
        order.set(["Work/C", "Work/A"], in: "Work")
        XCTAssertEqual(order.ordered(nested, in: "Work").map(\.path), ["Work/C", "Work/A", "Work/B"])
        XCTAssertEqual(order.ordered(nested, in: "Personal").map(\.path), ["Work/A", "Work/B", "Work/C"])
    }

    func testFolderOrderOnlyStoresUniqueDirectChildren() {
        XCTAssertTrue(JarvisFolderOrder.isValid(["Work", "Personal"], in: ""))
        XCTAssertTrue(JarvisFolderOrder.isValid(["Work/A"], in: "Work"))
        XCTAssertFalse(JarvisFolderOrder.isValid(["Work/A"], in: ""))
        XCTAssertFalse(JarvisFolderOrder.isValid(["Personal"], in: "Work"))
        XCTAssertFalse(JarvisFolderOrder.isValid(["Work", "Work"], in: ""))
        XCTAssertFalse(JarvisFolderOrder.isValid([".hidden"], in: ""))
        XCTAssertFalse(JarvisFolderOrder.isValid((0...JarvisFolderOrder.maximumFolders).map { "f\($0)" }, in: ""))
    }

    func testManualSortListsNotesByTitle() {
        let notes = [
            VaultNoteSummary(path: "b.md", title: "B", folder: "", directory: "", updatedAt: "2026-11-02T00:00:00Z"),
            VaultNoteSummary(path: "a.md", title: "A", folder: "", directory: "", updatedAt: "2026-11-01T00:00:00Z"),
        ]
        XCTAssertEqual(JarvisNotesPresentation.sorted(notes, by: .manual).map(\.title), ["A", "B"])
        XCTAssertEqual(JarvisNotesPresentation.sorted(notes, by: .updated).map(\.title), ["B", "A"])
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

    func testTaskPinsFollowTheTaskNotItsLineNumber() {
        func task(_ text: String, line: Int) -> VaultTask {
            VaultTask(id: String(repeating: "\(line)", count: 64).prefix(64).description, text: text, done: false, dueDate: nil,
                      dueTime: nil, dueAt: nil, priority: .normal, path: "Work/Inbox.md", line: line, heading: nil,
                      version: String(text.utf8.count) + String(repeating: "b", count: 63))
        }
        let pinned = task("Pay rent", line: 5)
        // The task above it was deleted, so the pinned task moved up and another took its old line number.
        let moved = task("Pay rent", line: 4)
        let other = task("Call back", line: 5)
        let sections = JarvisNotesLogic.taskSections(
            [moved, other], today: "2026-11-15", sort: .due, scope: .all, pinned: [pinned.pinKey]
        )
        XCTAssertEqual(sections.first?.kind, .pinned)
        XCTAssertEqual(sections.first?.tasks.map(\.text), ["Pay rent"])
    }
}
