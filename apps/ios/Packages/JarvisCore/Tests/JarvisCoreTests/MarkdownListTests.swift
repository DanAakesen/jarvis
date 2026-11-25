import XCTest
@testable import JarvisCore

final class MarkdownListTests: XCTestCase {
    private func pressingReturn(_ source: String) -> String {
        let text = source as NSString
        let caret = text.range(of: "|")
        let plain = text.replacingCharacters(in: caret, with: "") as NSString
        let selection = NSRange(location: caret.location, length: 0)
        let edit = JarvisMarkdownList.returnEdit(in: plain as String, selection: selection)
        let range = edit?.range ?? selection
        let result = (edit?.replacement ?? "\n") + "|"
        return plain.replacingCharacters(in: range, with: result)
    }

    func testReturnContinuesThenExitsAllThreeListTypes() {
        for (original, next) in [("- item", "- "), ("9. item", "10. "), ("- [x] item", "- [ ] ")] {
            let continued = pressingReturn(original + "|")
            XCTAssertEqual(continued, original + "\n" + next + "|")
            XCTAssertEqual(pressingReturn(continued), original + "\n|")
            XCTAssertEqual(pressingReturn(original + "\n" + next + "|\nLater"), original + "\n|\nLater")
        }
    }

    func testReturnSplitsAtUnicodeCaretAndKeepsIndent() {
        XCTAssertEqual(pressingReturn("Intro\n  * 👋🏽|later\nEnd"), "Intro\n  * 👋🏽\n  * |later\nEnd")
        XCTAssertEqual(pressingReturn("  2) [X] review|"), "  2) [X] review\n  3) [ ] |")
    }

    func testOrdinaryReturnAndFencedMarkdown() {
        XCTAssertEqual(pressingReturn("Hello|"), "Hello\n|")
        XCTAssertEqual(pressingReturn("~~~md\n- example|\n~~~"), "~~~md\n- example\n|\n~~~")
        XCTAssertEqual(pressingReturn("~~~md\n~~~\n+ item|"), "~~~md\n~~~\n+ item\n+ |")
    }
}
