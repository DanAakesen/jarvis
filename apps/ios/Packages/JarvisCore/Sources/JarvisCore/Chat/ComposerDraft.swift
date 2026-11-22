import Foundation
import Observation

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

    /// Put back an unacknowledged send without overwriting a newer draft.
    @discardableResult
    public mutating func restore(_ submitted: String, revision: UUID) -> Bool {
        guard revision == self.revision, text.isEmpty else { return false }
        text = submitted
        return true
    }
}

/// Chat observes text edits in the composer, not through its transcript model.
@MainActor
@Observable
public final class ChatComposerDraft {
    public var value = ComposerDraft()

    public init() {}

    public var hasMessage: Bool {
        !value.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
