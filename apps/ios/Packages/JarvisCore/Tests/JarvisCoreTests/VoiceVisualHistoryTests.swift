import XCTest
@testable import JarvisCore

final class VoiceVisualHistoryTests: XCTestCase {
    func testNewArrivalTakesFocusWhileEarlierVisualsRemainInOrder() throws {
        var history = VoiceVisualHistory()
        let first = try visual("first")
        let second = try visual("second")
        let third = try visual("third")
        history.present(first)
        history.present(second)
        history.select(first.id)
        history.present(third)

        XCTAssertEqual(history.entries, [first, second, third])
        XCTAssertEqual(history.selectedID, third.id)
        history.select(second.id)
        XCTAssertEqual(history.selectedID, second.id)
    }

    func testUpdatesReplaceTheExistingPageAndDismissalFallsBackToANeighbour() throws {
        var history = VoiceVisualHistory()
        let first = try visual("first")
        let second = try visual("second")
        let update = try visual("first", text: "Updated")
        history.present(first)
        history.present(second)
        history.present(update)

        XCTAssertEqual(history.entries, [update, second])
        XCTAssertEqual(history.selectedID, first.id)
        history.dismiss(first.id)
        history.select(first.id)
        XCTAssertEqual(history.entries, [second])
        XCTAssertEqual(history.selectedID, second.id)
        history.dismiss(second.id)
        XCTAssertNil(history.selectedID)
    }

    private func visual(_ id: String, text: String = "Sample") throws -> PresentedWorkspaceView {
        let json = """
        {"version":1,"title":"\(text)","renderer":"text","source":{"id":"now","status":"complete"},"data":{"format":"plain","content":"\(text)"}}
        """
        return PresentedWorkspaceView(viewId: id, view: try JSONDecoder().decode(GeneratedView.self, from: Data(json.utf8)))
    }
}
