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
}
