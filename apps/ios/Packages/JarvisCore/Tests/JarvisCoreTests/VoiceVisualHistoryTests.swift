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

    func testResizeAndMinimizeSwipesRequireDominantVerticalTravel() {
        XCTAssertEqual(VoiceVerticalSwipe(translation: CGSize(width: 10, height: -45), minimumDistance: 32), .up)
        XCTAssertEqual(VoiceVerticalSwipe(translation: CGSize(width: -12, height: 32), minimumDistance: 32), .down)
        XCTAssertNil(VoiceVerticalSwipe(translation: CGSize(width: 0, height: 31), minimumDistance: 32))
        XCTAssertNil(VoiceVerticalSwipe(translation: CGSize(width: -60, height: -35), minimumDistance: 32))
        XCTAssertNil(VoiceVerticalSwipe(translation: CGSize(width: 50, height: 50), minimumDistance: 32))
    }

    private func visual(_ id: String, text: String = "Sample") throws -> PresentedWorkspaceView {
        let json = """
        {"version":1,"title":"\(text)","renderer":"text","source":{"id":"now","status":"complete"},"data":{"format":"plain","content":"\(text)"}}
        """
        return PresentedWorkspaceView(viewId: id, view: try JSONDecoder().decode(GeneratedView.self, from: Data(json.utf8)))
    }
}
