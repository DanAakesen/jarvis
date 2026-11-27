import Foundation

/// An inline format and its visible text, indexed in the original UTF-16 Markdown.
struct JarvisNoteInlineSpan {
    enum Style { case code, highlight, bold, italic, link }
    let style: Style
    let range: NSRange
    let content: NSRange

    private static let patterns: [(Style, NSRegularExpression)] = [
        (.code, #"(`+)(.+?)\1(?!`)"#),
        (.highlight, #"==(?=\S)(.+?)(?<=\S)=="#),
        (.bold, #"(\*\*|__)(?=\S)(.+?)(?<=\S)\1"#),
        (.italic, #"(?<!\*)(\*)(?!\*)(?=\S)(.+?)(?<=\S)(?<!\*)\1(?!\*)"#),
        (.italic, #"(?<![\w_])(_)(?!_)(?=\S)(.+?)(?<=\S)\1(?![\w_])"#),
        (.link, #"\[\[(?:[^\]|]+\|)?([^\]|]+)\]\]"#),
        (.link, #"(?<!!)\[([^\[\]]+)\]\([^)]+\)"#)
    ].map { (style: Style, pattern: String) in
        (style, try! NSRegularExpression(pattern: #"(?<!\\)"# + pattern))
    }

    static func parse(_ line: String) -> [Self] {
        let range = NSRange(line.startIndex..., in: line)
        var spans: [Self] = []
        var codeRanges: [NSRange] = []
        for (style, regex) in patterns {
            for match in regex.matches(in: line, range: range) {
                if style == .code {
                    codeRanges.append(match.range)
                } else if codeRanges.contains(where: { NSLocationInRange(match.range.location, $0)
                    || NSLocationInRange(NSMaxRange(match.range) - 1, $0) }) {
                    continue
                }
                spans.append(Self(style: style, range: match.range,
                                  content: match.range(at: match.numberOfRanges - 1)))
            }
        }
        return spans
    }
}
