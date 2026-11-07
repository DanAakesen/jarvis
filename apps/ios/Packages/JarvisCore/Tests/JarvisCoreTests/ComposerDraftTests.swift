import XCTest
@testable import JarvisCore

final class ComposerDraftTests: XCTestCase {
    func testLateKeyboardEditCannotRestoreSubmittedTextOrOverwriteNextDraft() {
        var draft = ComposerDraft(text: "Yes please")
        let submittedEditor = draft.revision
        XCTAssertEqual(draft.consume(), "Yes please")
        draft.edit("Yes please", revision: submittedEditor)
        XCTAssertEqual(draft.text, "")
        let nextEditor = draft.revision
        draft.edit("My next message", revision: nextEditor)
        draft.edit("Yes please ", revision: submittedEditor)
        XCTAssertEqual(draft.text, "My next message")
        XCTAssertEqual(draft.revision, nextEditor)
    }

    func testNewEditorCanIntentionallySendTheSameTextAgain() {
        var draft = ComposerDraft(text: "?")
        XCTAssertEqual(draft.consume(), "?")
        draft.edit("?", revision: draft.revision)
        XCTAssertEqual(draft.consume(), "?")
        XCTAssertEqual(draft.text, "")
    }
}
