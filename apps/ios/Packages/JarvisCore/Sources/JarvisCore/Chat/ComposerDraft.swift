import Foundation

/// A submitted editor is a different input session from the next draft. Text-input
/// systems may deliver a final edit after submit; that edit must not restore it.
public struct ComposerDraft: Equatable, Sendable {
    public private(set) var text: String
    public private(set) var revision = UUID()

    public init(text: String = "") { self.text = text }

    public mutating func replace(with text: String) { self.text = text }

    public mutating func edit(_ text: String, revision: UUID) {
        guard revision == self.revision else { return }
        self.text = text
    }

    public mutating func consume() -> String {
        let submitted = text
        revision = UUID()
        text = ""
        return submitted
    }
}
