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

    func testTypingBesideTableAtFileBoundaryKeepsSeparateLines() {
        let table = JarvisMarkdownTable().markdown
        var blocks = JarvisMarkdownBlock.parse(table)
        XCTAssertEqual(JarvisMarkdownBlock.document(blocks), table)
        blocks[0].text = "Before"
        blocks[blocks.count - 1].text = "After"
        let saved = JarvisMarkdownBlock.document(blocks)
        XCTAssertEqual(saved, "Before\n\n" + table + "\n\nAfter")
        XCTAssertEqual(JarvisMarkdownBlock.parse(saved).compactMap(\.table), [JarvisMarkdownTable()])
    }

    func testLiteralBackslashesBeforePipeInCell() {
        var table = JarvisMarkdownTable()
        table.set(#"a\|b\\|c|d"#, row: 1, column: 0)
        let reopened = JarvisMarkdownBlock.parse(table.markdown).compactMap(\.table)
        XCTAssertEqual(reopened, [table])
    }

    func testSavingLegacyTableSeparatesParagraphsAndPreservesCells() {
        let table = "| One | Two | 3 |\n| --- | :---: | ---: |\n| A | B | C |"
        let legacy = "Opening paragraph\n" + table + "\nChecklist\n- [ ] First"
        let expected = "Opening paragraph\n\n" + table + "\n\nChecklist\n- [ ] First"
        let saved = JarvisMarkdownBlock.document(JarvisMarkdownBlock.parse(legacy))
        XCTAssertEqual(saved, expected)
        XCTAssertEqual(JarvisMarkdownBlock.document(JarvisMarkdownBlock.parse(saved)), expected)
    }

    func testExistingBlankLinesAndFileEdgesRemainUntouched() {
        let table = JarvisMarkdownTable().markdown
        for source in [table, table + "\n", "\n" + table, "Before\n \n" + table + "\n\t\nAfter"] {
            XCTAssertEqual(JarvisMarkdownBlock.document(JarvisMarkdownBlock.parse(source)), source)
        }
    }

    func testIndentedCodeContainingTableSyntaxKeepsItsLines() {
        let code = "    Example\n    | A | B |\n    | --- | --- |\n    Done"
        let blocks = JarvisMarkdownBlock.parse(code)
        XCTAssertTrue(blocks.compactMap(\.table).isEmpty)
        XCTAssertEqual(JarvisMarkdownBlock.document(blocks), code)
    }

    func testUntouchedTablesAndFencedExamplesRoundTrip() {
        let fence = String(repeating: "\u{60}", count: 3)
        let raw = "| A | B |\n| :--- | ---: |\n|  x | y  |"
        let source = "\(fence)md\n\(raw)\n\(fence)\n\n\(raw)\n\nText\n\n\(raw)\n"
        let blocks = JarvisMarkdownBlock.parse(source)
        XCTAssertEqual(blocks.compactMap(\.table).count, 2)
        XCTAssertEqual(blocks.map(\.text).joined(), source)
        XCTAssertEqual(JarvisMarkdownBlock.document(blocks), source)
        var table = blocks.compactMap(\.table)[0]
        table.addRow()
        XCTAssertTrue(table.markdown.contains("| :--- | ---: |"))
    }
}
