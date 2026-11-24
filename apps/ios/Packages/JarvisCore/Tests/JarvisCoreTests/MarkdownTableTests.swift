import XCTest
@testable import JarvisCore

final class MarkdownTableTests: XCTestCase {
    func testInsertAndGrowReopensAsTwoColumnsAndTwoRowsBeforeEdits() {
        var table = JarvisMarkdownTable()
        XCTAssertEqual(table.rows, [["", ""], ["", ""]])
        table.set("A | B", row: 1, column: 0)
        table.addRow()
        table.addColumn()
        let blocks = JarvisMarkdownBlock.parse("Before\n\n" + table.markdown + "\n\nAfter")
        XCTAssertEqual(blocks.compactMap(\.table), [table])
        XCTAssertEqual(blocks.first?.text, "Before\n\n")
        XCTAssertEqual(blocks.last?.text, "\n\nAfter")
    }

    func testUntouchedTablesAndFencedExamplesRoundTrip() {
        let fence = String(repeating: "\u{60}", count: 3)
        let raw = "| A | B |\n| :--- | ---: |\n|  x | y  |"
        let source = "\(fence)md\n\(raw)\n\(fence)\n\n\(raw)\n\nText\n\n\(raw)\n"
        let blocks = JarvisMarkdownBlock.parse(source)
        XCTAssertEqual(blocks.compactMap(\.table).count, 2)
        XCTAssertEqual(blocks.map(\.text).joined(), source)
        var table = blocks.compactMap(\.table)[0]
        table.addRow()
        XCTAssertTrue(table.markdown.contains("| :--- | ---: |"))
    }
}
