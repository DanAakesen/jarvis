import JarvisCore
import XCTest

final class ChatComposerDraftTests: XCTestCase {
    @MainActor
    func testEditorAndSendUseTheSameDraftAndRejectLateEdits() async {
        let draft = ChatComposerDraft()
        let editingRevision = draft.value.revision
        draft.value.edit(" \n ", revision: editingRevision)
        XCTAssertFalse(draft.hasMessage)

        draft.value.replace(with: "A dictation or Home handoff")
        draft.value.edit("A dictation or Home handoff, edited", revision: editingRevision)
        XCTAssertTrue(draft.hasMessage)
        XCTAssertEqual(draft.value.consume(), "A dictation or Home handoff, edited")

        draft.value.edit("late callback", revision: editingRevision)
        XCTAssertFalse(draft.hasMessage)
        XCTAssertEqual(draft.value.text, "")
    }

    func testUnacknowledgedSendRestoresExactTextWithoutReplacingANewerDraft() {
        var draft = ComposerDraft(text: "Keep my text\n")
        let sent = draft.consume()
        let revision = draft.revision
        XCTAssertTrue(draft.restore(sent, revision: revision))
        XCTAssertEqual(draft.text, "Keep my text\n")
        draft.edit("Something new", revision: revision)
        XCTAssertFalse(draft.restore(sent, revision: revision))
        XCTAssertEqual(draft.consume(), "Something new")
        XCTAssertFalse(draft.restore(sent, revision: revision))
        XCTAssertEqual(draft.text, "")
    }
}
