import Foundation

/// Builds the composer text while dictation streams in.
///
/// The speech recogniser reports one growing transcript per segment and starts a new, shorter one after
/// a pause. Replacing the field with each report would delete the words already transcribed, so a segment
/// that restarts is committed to the text before it.
public struct DictationTranscript: Equatable, Sendable {
    private var committed: String
    private var segment = ""

    public init(base: String) {
        committed = base.isEmpty || base.hasSuffix(" ") || base.hasSuffix("\n") ? base : base + " "
    }

    /// The full field text for the current state.
    public var text: String { committed + segment }

    /// Applies a streamed report and returns the full field text.
    public mutating func update(_ report: String) -> String {
        if !segment.isEmpty, Self.startsNewSegment(previous: segment, next: report) {
            committed += segment.hasSuffix(" ") ? segment : segment + " "
        }
        segment = report
        return text
    }

    private static func startsNewSegment(previous: String, next: String) -> Bool {
        guard !next.isEmpty else { return false }
        guard next.count < previous.count else { return false }
        return firstWord(previous) != firstWord(next)
    }

    private static func firstWord(_ value: String) -> String {
        let word = value.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        return word.filter { $0.isLetter || $0.isNumber }.lowercased()
    }
}
