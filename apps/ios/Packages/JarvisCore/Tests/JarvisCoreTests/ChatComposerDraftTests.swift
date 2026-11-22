import JarvisCore
import Observation
import XCTest

final class ChatComposerDraftTests: XCTestCase {
    @MainActor
    func testTypingWithinASendableDraftDoesNotInvalidateSendControls() async {
        let draft = ChatComposerDraft()
        draft.value.replace(with: "H")
        withObservationTracking {
            XCTAssertTrue(draft.hasMessage)
        } onChange: {
            XCTFail("Typing within a sendable draft invalidated the composer controls")
        }

        let revision = draft.value.revision
        for text in ["He", "Hej", "Hej 👋", "Hej 👋\nverden"] {
            draft.value.edit(text, revision: revision)
            XCTAssertEqual(draft.value.text, text)
        }
    }

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
