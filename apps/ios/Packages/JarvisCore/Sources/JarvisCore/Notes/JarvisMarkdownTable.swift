import Foundation

/// Text and editable pipe tables in document order. An untouched block retains its original Markdown.
public struct JarvisMarkdownBlock: Identifiable, Equatable, Sendable {
    public let id = UUID()
    public var text: String
    public var table: JarvisMarkdownTable?
    public init(text: String, table: JarvisMarkdownTable? = nil) {
        self.text = text
        self.table = table
    }

    public static func document(_ blocks: [Self]) -> String {
        var source = ""
        var precedingTable = false
        for block in blocks where !block.text.isEmpty {
            if precedingTable || block.table != nil {
                // Obsidian needs a blank line between a table and surrounding prose.
                let trailing = source.reversed().prefix(while: \.isWhitespace)
                let leading = block.text.prefix(while: \.isWhitespace)
                if trailing.endIndex != source.reversed().endIndex, leading.endIndex != block.text.endIndex {
                    let breaks = trailing.filter(\.isNewline).count + leading.filter(\.isNewline).count
                    let newline = trailing.first(where: \.isNewline) ?? leading.first(where: \.isNewline) ?? "\n"
                    source += String(repeating: String(newline), count: max(0, 2 - breaks))
                }
            }
            source += block.text
            precedingTable = block.table != nil
        }
        return source
    }

    public static func parse(_ source: String) -> [Self] {
        let lines = source.components(separatedBy: "\n")
        var result: [Self] = []
        var pending = ""
        var index = 0
        var fence: (Character, Int)?
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.drop(while: { $0 == " " })
            if let marker = trimmed.first, marker == "~" || marker == "\u{60}" {
                let count = trimmed.prefix(while: { $0 == marker }).count
                if let open = fence {
                    if open.0 == marker, count >= open.1, trimmed.dropFirst(count).allSatisfy(\.isWhitespace) { fence = nil }
                } else if count >= 3 { fence = (marker, count) }
            }
            if fence == nil, index + 1 < lines.count,
               let header = JarvisMarkdownTable.cells(line),
               let dividers = JarvisMarkdownTable.cells(lines[index + 1]),
               header.count == dividers.count,
               dividers.allSatisfy({ $0.range(of: #"^:?-+:?$"#, options: .regularExpression) != nil }) {
                result.append(Self(text: pending))
                pending = ""
                let start = index
                index += 2
                var rows = [header]
                while index < lines.count, let cells = JarvisMarkdownTable.cells(lines[index]), cells.count == header.count {
                    rows.append(cells)
                    index += 1
                }
                result.append(Self(text: lines[start..<index].joined(separator: "\n"),
                                   table: JarvisMarkdownTable(rows: rows, dividers: dividers)))
                if index < lines.count { pending = "\n" }
            } else {
                pending += line
                index += 1
                if index < lines.count { pending += "\n" }
            }
        }
        result.append(Self(text: pending))
        return result
    }
}

public struct JarvisMarkdownTable: Equatable, Sendable {
    public private(set) var rows: [[String]]
    private var dividers: [String]
    public init() {
        rows = [["", ""], ["", ""]]
        dividers = ["---", "---"]
    }
    fileprivate init(rows: [[String]], dividers: [String]) {
        self.rows = rows
        self.dividers = dividers
    }
    public mutating func addRow() { rows.append(Array(repeating: "", count: dividers.count)) }
    public mutating func addColumn() {
        dividers.append("---")
        for row in rows.indices { rows[row].append("") }
    }
    public mutating func set(_ value: String, row: Int, column: Int) {
        guard rows.indices.contains(row), rows[row].indices.contains(column) else { return }
        rows[row][column] = value.replacingOccurrences(of: "\n", with: "<br>")
    }

    fileprivate static func cells(_ line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("|"), !trimmed.isEmpty else { return nil }
        var result: [String] = [], cell = "", slashes = 0
        for char in trimmed {
            if char == "|", slashes.isMultiple(of: 2) {
                result.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else if char == "|" {
                cell.removeLast(slashes / 2 + 1)
                cell.append(char)
            } else { cell.append(char) }
            slashes = char == "\\" ? slashes + 1 : 0
        }
        result.append(cell.trimmingCharacters(in: .whitespaces))
        if trimmed.first == "|" { result.removeFirst() }
        if result.last == "", trimmed.last == "|" { result.removeLast() }
        return result.isEmpty ? nil : result
    }

    public var markdown: String {
        func line(_ cells: [String]) -> String {
            let encoded = cells.map { cell in
                var value = "", slashes = 0
                for character in cell {
                    if character == "|" { value += String(repeating: "\\", count: slashes + 1) }
                    value.append(character)
                    slashes = character == "\\" ? slashes + 1 : 0
                }
                return value
            }
            return "| " + encoded.joined(separator: " | ") + " |"
        }
        return ([line(rows[0]), line(dividers)] + rows.dropFirst().map(line)).joined(separator: "\n")
    }
}
