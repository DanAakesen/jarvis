import Foundation

/// An unknown outcome freezes the exact request, not just its UUID. Only a
/// confirmed needsDetails response permits corrections under the same key.
public struct WatchLiftCaptureDraft: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case editing, submitting, uncertain, needsDetails, saved, deleted }
    public private(set) var idempotencyKey: UUID
    public private(set) var text: String
    public private(set) var requestText: String?
    public private(set) var phase: Phase = .editing
    public private(set) var result: JarvisLiftCaptureResult?

    public init(idempotencyKey: UUID = UUID(), text: String = "") {
        self.idempotencyKey = idempotencyKey
        self.text = text
    }

    public var canEdit: Bool { phase == .editing || phase == .needsDetails }
    public var canSubmit: Bool {
        phase != .submitting && phase != .saved && phase != .deleted &&
        JarvisLiftCaptureRequest(idempotencyKey: idempotencyKey, text: requestText ?? text).isValid
    }
    @discardableResult public mutating func updateText(_ value: String) -> Bool {
        guard canEdit else { return false }
        text = value
        return true
    }
    public mutating func beginSubmission(reachable: Bool) -> JarvisLiftCaptureRequest? {
        guard reachable, canSubmit else { return nil }
        if phase != .uncertain { requestText = text }
        guard let requestText else { return nil }
        phase = .submitting
        return .init(idempotencyKey: idempotencyKey, text: requestText)
    }
    public mutating func receive(_ value: JarvisLiftCaptureResult) {
        guard phase == .submitting else { return }
        result = value
        switch value {
        case .saved: phase = .saved
        case .deleted: phase = .deleted
        case .needsDetails:
            phase = .needsDetails
            requestText = nil
        }
    }
    public mutating func failSubmission() {
        guard phase == .submitting else { return }
        phase = .uncertain
    }
    public mutating func startAnother() {
        guard phase == .saved || phase == .deleted else { return }
        self = .init()
    }

    public static func restore(from data: Data) throws -> Self {
        var value = try JSONDecoder().decode(Self.self, from: data)
        if value.phase == .submitting { value.phase = .uncertain }
        if value.phase == .uncertain {
            guard let text = value.requestText, text == value.text,
                  JarvisLiftCaptureRequest(idempotencyKey: value.idempotencyKey, text: text).isValid else {
                throw WatchFailure.invalidRequest
            }
        }
        if value.phase == .saved {
            guard case .saved = value.result else { throw WatchFailure.invalidRequest }
        }
        if value.phase == .deleted {
            guard case .deleted = value.result else { throw WatchFailure.invalidRequest }
        }
        return value
    }
}

/// Persist before returning any submission to the transport. A storage failure
/// must not turn a possibly committed operation into a fresh draft.
@MainActor public final class WatchLiftCaptureStore {
    public private(set) var draft: WatchLiftCaptureDraft
    private let fileURL: URL

    public init(fileURL: URL) throws {
        self.fileURL = fileURL
        if FileManager.default.fileExists(atPath: fileURL.path) {
            draft = try WatchLiftCaptureDraft.restore(from: Data(contentsOf: fileURL))
        } else {
            draft = .init()
        }
    }
    public func updateText(_ text: String) throws {
        var next = draft
        guard next.updateText(text) else { return }
        try persist(next)
    }
    public func beginSubmission(reachable: Bool) throws -> JarvisLiftCaptureRequest? {
        var next = draft
        guard let request = next.beginSubmission(reachable: reachable) else { return nil }
        try persist(next)
        return request
    }
    public func receive(_ result: JarvisLiftCaptureResult) throws {
        var next = draft
        next.receive(result)
        try persist(next)
    }
    public func failSubmission() throws {
        var next = draft
        next.failSubmission()
        try persist(next)
    }
    public func startAnother() throws {
        var next = draft
        next.startAnother()
        try persist(next)
    }
    private func persist(_ next: WatchLiftCaptureDraft) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: fileURL, options: .atomic)
        draft = next
    }
}
