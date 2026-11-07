import Foundation

enum ChatMarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case listItem(marker: String, text: String)

    static func parse(_ markdown: String) -> [ChatMarkdownBlock] {
        var blocks: [ChatMarkdownBlock] = []
        var paragraphLines: [String] = []

        func appendParagraph() {
            guard !paragraphLines.isEmpty else { return }
            blocks.append(.paragraph(paragraphLines.joined(separator: " ")))
            paragraphLines.removeAll()
        }

        for sourceLine in markdown.components(separatedBy: .newlines) {
            let line = sourceLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else {
                appendParagraph()
                continue
            }

            let headingLevel = line.prefix(while: { $0 == "#" }).count
            if (1...6).contains(headingLevel),
               line.dropFirst(headingLevel).first?.isWhitespace == true {
                appendParagraph()
                let heading = line.dropFirst(headingLevel).trimmingCharacters(in: .whitespaces)
                blocks.append(.heading(level: headingLevel, text: heading))
                continue
            }

            if let marker = ["- ", "* ", "+ "].first(where: line.hasPrefix) {
                appendParagraph()
                blocks.append(.listItem(
                    marker: "•",
                    text: String(line.dropFirst(marker.count))
                ))
                continue
            }

            if let listItem = numberedListItem(line) {
                appendParagraph()
                blocks.append(.listItem(marker: listItem.marker, text: listItem.text))
                continue
            }

            paragraphLines.append(line)
        }

        appendParagraph()
        return blocks
    }

    private static func numberedListItem(_ line: String) -> (marker: String, text: String)? {
        guard let separator = line.firstIndex(where: { $0 == "." || $0 == ")" }),
              line[line.index(after: separator)...].first?.isWhitespace == true else {
            return nil
        }
        let number = line[..<separator]
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { return nil }
        let text = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        return ("\(number)\(line[separator])", text)
    }
}

