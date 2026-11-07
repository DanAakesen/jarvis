import Foundation

/// A lossless editing projection. Only the edited line changes; frontmatter, unknown Markdown,
/// whitespace and line endings survive a formatted/raw round trip byte for byte.
public struct JarvisNoteDocument: Equatable, Sendable {
    public struct Block: Equatable, Sendable, Identifiable {
        public let id = UUID()
        public var prefix: String
        public var text: String
        public var ending: String
        public let isCode: Bool

        public var headingLevel: Int {
            guard !isCode else { return 0 }
            return prefix.prefix(while: { $0 == "#" }).count
        }
        public var isChecklist: Bool { !isCode && prefix.range(of: #"^\s*[-*+] \[[ xX]\] "#, options: .regularExpression) != nil }
        public var isChecked: Bool { isChecklist && prefix.lowercased().contains("[x]") }
        public var isBullet: Bool { !isCode && !isChecklist && prefix.range(of: #"^\s*([-*+] |\d+[.)] )"#, options: .regularExpression) != nil }
        public var markdown: String { prefix + text + ending }

        public mutating func toggleCheck() {
            guard isChecklist else { return }
            prefix = prefix.replacingOccurrences(of: isChecked ? #"\[[xX]\]"# : #"\[ \]"#,
                with: isChecked ? "[ ]" : "[x]", options: .regularExpression)
        }
    }

    public private(set) var metadata: String
    public var blocks: [Block]

    public init(_ source: String) {
        var lines: [(String, String)] = []
        let parts = source.components(separatedBy: "\n")
        for (index, part) in parts.enumerated() {
            let hasNewline = index < parts.count - 1
            if hasNewline && part.hasSuffix("\r") {
                lines.append((String(part.dropLast()), "\r\n"))
            } else { lines.append((part, hasNewline ? "\n" : "")) }
        }
        metadata = ""
        if lines.first?.0 == "---", let end = lines.dropFirst().firstIndex(where: { $0.0 == "---" || $0.0 == "..." }) {
            metadata = lines[...end].map { $0.0 + $0.1 }.joined()
            lines.removeFirst(end + 1)
        }
        var codeFence: String?
        blocks = lines.map { line, ending in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let marker = trimmed.hasPrefix("```") ? "```" : trimmed.hasPrefix("~~~") ? "~~~" : nil
            let isCode = codeFence != nil || marker != nil
            if let marker { codeFence = codeFence == marker ? nil : codeFence ?? marker }
            let range = isCode ? nil : line.range(of: #"^(#{1,6} |\s*[-*+] \[[ xX]\] |\s*[-*+] |\s*\d+[.)] |\s*> )"#, options: .regularExpression)
            let prefix = range.map { String(line[$0]) } ?? ""
            return Block(prefix: prefix, text: String(line.dropFirst(prefix.count)), ending: ending, isCode: isCode)
        }
        if blocks.isEmpty { blocks = [Block(prefix: "", text: "", ending: "", isCode: false)] }
    }

    public var markdown: String { metadata + blocks.map(\.markdown).joined() }

    @discardableResult
    public mutating func append(prefix: String, text: String = "") -> UUID {
        let newline = blocks.first(where: { !$0.ending.isEmpty })?.ending ?? "\n"
        if let last = blocks.indices.last, blocks[last].ending.isEmpty { blocks[last].ending = newline }
        let block = Block(prefix: prefix, text: text, ending: "", isCode: false)
        blocks.append(block)
        return block.id
    }
}
