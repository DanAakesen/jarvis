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

    func testRelativeCommandsFollowManualFocusAndCloseOnlyTheSelectedResult() throws {
        var history = VoiceVisualHistory()
        XCTAssertFalse(history.apply(.close))
        for id in ["forecast", "rain", "walk"] { history.present(try visual(id)) }
        XCTAssertFalse(history.apply(.next))
        history.select("forecast")
        XCTAssertFalse(history.apply(.previous))
        XCTAssertTrue(history.apply(.next))
        XCTAssertEqual(history.selected?.id, "rain")
        XCTAssertTrue(history.apply(.close))
        XCTAssertEqual(history.entries.map(\.id), ["forecast", "walk"])
        XCTAssertEqual(history.selected?.id, "walk")
        XCTAssertTrue(history.apply(.previous))
        XCTAssertEqual(history.selected?.id, "forecast")
        XCTAssertTrue(history.apply(.close))
        XCTAssertTrue(history.apply(.close))
        XCTAssertNil(history.selected)
        XCTAssertFalse(history.apply(.next))
    }

    func testClosedWindowsRemainAvailableOnlyInsideTheirCall() throws {
        var history = VoiceVisualHistory()
        let first = try visual("one"), second = try visual("two")
        history.present(first)
        history.present(second)
        history.dismissAll()
        XCTAssertNil(history.selected)
        XCTAssertEqual(history.windows, [first, second])
        history.present(second)
        history.present(first)
        XCTAssertEqual(history.entries, [first, second])
        XCTAssertEqual(history.selectedID, first.id)
        XCTAssertTrue(VoiceVisualHistory().windows.isEmpty)
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
