import Foundation

public enum JarvisMarkdownList {
    /// The replacement for Return at a native text selection. A nil result uses the editor's usual Return.
    public static func returnEdit(in text: String, selection: NSRange) -> (range: NSRange, replacement: String)? {
        guard let selected = Range(selection, in: text) else { return nil }
        let before = text[..<selected.lowerBound]
        let start = before.lastIndex(where: \.isNewline).map { text.index(after: $0) } ?? text.startIndex
        let end = text[selected.lowerBound...].firstIndex(where: \.isNewline) ?? text.endIndex
        guard selected.upperBound <= end else { return nil }

        let line = String(text[start..<end])
        guard let match = marker.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
              before[start...].utf16.count >= match.range.length,
              !insideFence(text[..<start]) else { return nil }
        let source = line as NSString
        let content = source.substring(from: match.range.length)
        if content.allSatisfy(\.isWhitespace) {
            return (NSRange(start..<end, in: text), "")
        }
        let indent = source.substring(with: match.range(at: 1))
        var next = source.substring(with: match.range(at: 2))
        if let delimiter = next.last, let number = Int(next.dropLast()) {
            next = "\(number + 1)\(delimiter)"
        }
        let checkbox = match.range(at: 4).location == NSNotFound ? "" : "[ ] "
        return (selection, "\n" + indent + next + " " + checkbox)
    }

    private static let marker = try! NSRegularExpression(pattern: #"^([ \t]*)([-+*]|[0-9]{1,9}[.)])([ \t]+)(?:\[[ xX]\]([ \t]+))?"#)

    private static func insideFence(_ prefix: Substring) -> Bool {
        var fence: (marker: Character, length: Int)?
        for line in prefix.split(whereSeparator: \.isNewline) {
            let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
            guard let marker = trimmed.first, marker == "\u{60}" || marker == "~" else { continue }
            let count = trimmed.prefix(while: { $0 == marker }).count
            if let open = fence {
                if open.marker == marker, count >= open.length, trimmed.dropFirst(count).allSatisfy(\.isWhitespace) {
                    fence = nil
                }
            } else if count >= 3 {
                fence = (marker, count)
            }
        }
        return fence != nil
    }
}
