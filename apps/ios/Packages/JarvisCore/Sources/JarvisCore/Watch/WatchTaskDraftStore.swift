import Foundation

public struct WatchTaskEditorRecord: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case create, edit }
    public enum Phase: String, Codable, Sendable {
        case editing, submitting, uncertain, rejected, requiresRefresh, saved
    }

    public let schemaVersion: Int
    public let kind: Kind
    public var draft: WatchTaskDraft
    public var submissions: WatchTaskSubmissionState
    public var source: VaultTask?
    public var update: WatchTaskUpdateRequest?
    public var phase: Phase
    public var savedTask: VaultTask?
    public var selectedDue: Date
    public var customDue: Bool
    public var includeTime: Bool
    public var remindAtDue: Bool
    public var reapplying: Bool

    public init(createSelectedDue: Date = Date().addingTimeInterval(3_600)) {
        schemaVersion = 1
        kind = .create
        draft = .init()
        submissions = .init()
        source = nil
        update = nil
        phase = .editing
        savedTask = nil
        selectedDue = createSelectedDue
        customDue = false
        includeTime = true
        remindAtDue = false
        reapplying = false
    }

    public init(editing task: VaultTask, selectedDue: Date? = nil) {
        schemaVersion = 1
        kind = .edit
        var value = WatchTaskDraft()
        value.mode = .manual
        value.fields = .init(
            text: task.text, scope: task.scope, due: task.dueDate, time: task.dueTime,
            priority: task.priority, notes: task.notes ?? ""
        )
        draft = value
        submissions = .init()
        source = task
        update = nil
        phase = .editing
        savedTask = nil
        self.selectedDue = selectedDue ?? Self.date(task) ?? Date().addingTimeInterval(3_600)
        customDue = task.dueDate != nil
        includeTime = task.dueTime != nil
        remindAtDue = task.remindAtDue == true
        reapplying = false
    }

    static func restore(from data: Data) throws -> Self {
        guard data.count <= WatchTaskDraftStore.maximumBytes else { throw WatchFailure.invalidRequest }
        var value = try JSONDecoder().decode(Self.self, from: data)
        try value.submissions.restoreAfterProcessDeath()
        if value.phase == .submitting {
            value.phase = value.kind == .create ? .uncertain : .requiresRefresh
        }
        try value.validate()
        return value
    }

    func validate() throws {
        guard schemaVersion == 1,
              (try? JSONEncoder().encode(self).count).map({ $0 <= WatchTaskDraftStore.maximumBytes }) == true,
              draft.input.utf8.count <= 8_000,
              draft.fields.text.utf8.count <= 4_000,
              draft.fields.notes.utf8.count <= 16_000 else {
            throw WatchFailure.invalidRequest
        }
        switch kind {
        case .create:
            guard source == nil, update == nil, !remindAtDue,
                  phase != .requiresRefresh,
                  phase != .saved || savedTask.map(WatchTaskValidation.task) == true else {
                throw WatchFailure.invalidRequest
            }
            if phase == .submitting || phase == .uncertain || phase == .rejected {
                guard submissions.request != nil,
                      submissions.canRevise == (phase == .rejected),
                      submissions.uncertain == (phase == .uncertain) else {
                    throw WatchFailure.invalidRequest
                }
            } else if phase == .editing {
                guard submissions.request == nil, savedTask == nil else { throw WatchFailure.invalidRequest }
            } else if phase == .saved {
                guard submissions.request != nil, !submissions.sending,
                      !submissions.canRevise, !submissions.uncertain else {
                    throw WatchFailure.invalidRequest
                }
            }
        case .edit:
            guard submissions.request == nil, draft.mode == .manual,
                  let source, WatchTaskValidation.task(source),
                  source.scope == draft.fields.scope,
                  phase != .rejected && phase != .uncertain else {
                throw WatchFailure.invalidRequest
            }
            if let update {
                guard update.isValid, update.path == source.path, update.line == source.line,
                      update.text == source.text, update.version == source.version else {
                    throw WatchFailure.invalidRequest
                }
            }
            if phase == .submitting {
                guard update != nil, savedTask == nil else { throw WatchFailure.invalidRequest }
            } else if phase == .requiresRefresh {
                guard savedTask == nil else { throw WatchFailure.invalidRequest }
            } else if phase == .editing {
                guard update == nil, savedTask == nil else { throw WatchFailure.invalidRequest }
            } else if phase == .saved {
                guard update != nil, savedTask.map(WatchTaskValidation.task) == true else {
                    throw WatchFailure.invalidRequest
                }
            }
        }
        if phase != .saved, savedTask != nil { throw WatchFailure.invalidRequest }
    }

    private static func date(_ task: VaultTask) -> Date? {
        guard let due = task.dueDate else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = task.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        formatter.isLenient = false
        return formatter.date(from: due + " " + (task.dueTime ?? "12:00"))
    }
}

/// Local, atomic persistence for the one editor represented by `fileURL`.
/// Every transport-bound request is committed here before it is returned.
@MainActor public final class WatchTaskDraftStore {
    nonisolated static let maximumBytes = 64 * 1024
    public private(set) var record: WatchTaskEditorRecord
    private let fileURL: URL

    public init(fileURL: URL, createSelectedDue: Date = Date().addingTimeInterval(3_600)) throws {
        self.fileURL = fileURL
        if FileManager.default.fileExists(atPath: fileURL.path) {
            record = try Self.read(fileURL)
            guard record.kind == .create else { throw WatchFailure.invalidRequest }
        } else {
            record = .init(createSelectedDue: createSelectedDue)
        }
    }

    public init(fileURL: URL, editing task: VaultTask) throws {
        self.fileURL = fileURL
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let recovered = try Self.read(fileURL)
            guard recovered.kind == .edit, recovered.source?.id == task.id else {
                throw WatchFailure.invalidRequest
            }
            if recovered.phase == .saved {
                if recovered.savedTask?.version == task.version ||
                    recovered.source?.version != task.version {
                    let next = WatchTaskEditorRecord(editing: task)
                    try Self.write(next, to: fileURL)
                    record = next
                } else {
                    record = recovered
                }
            } else {
                var next = recovered
                if next.phase == .editing, next.source?.version != task.version {
                    next.phase = .requiresRefresh
                    try next.validate()
                    try Self.write(next, to: fileURL)
                }
                record = next
            }
        } else {
            record = .init(editing: task)
        }
    }

    public func update(
        draft: WatchTaskDraft, selectedDue: Date, customDue: Bool,
        includeTime: Bool, remindAtDue: Bool
    ) throws {
        guard record.phase == .editing else { return }
        var next = record
        next.draft = draft
        next.selectedDue = selectedDue
        next.customDue = customDue
        next.includeTime = includeTime
        next.remindAtDue = remindAtDue
        try persist(next)
    }

    public func beginCreate(
        now: Date = Date(), timeZone: TimeZone = .current, makeID: () -> UUID = UUID.init
    ) throws -> WatchTaskCreateRequest {
        guard record.kind == .create,
              record.phase == .editing || record.phase == .uncertain || record.phase == .rejected else {
            throw WatchTaskSubmissionError.sending
        }
        var next = record
        let request = try next.submissions.begin(next.draft, now: now, timeZone: timeZone, makeID: makeID)
        next.phase = .submitting
        try persist(next)
        return request
    }

    public func beginEdit(_ request: WatchTaskUpdateRequest) throws {
        guard record.kind == .edit, record.phase == .editing,
              let source = record.source,
              request.path == source.path, request.line == source.line,
              request.text == source.text, request.version == source.version else {
            throw WatchFailure.invalidRequest
        }
        var next = record
        next.update = request
        next.phase = .submitting
        try persist(next)
    }

    public func finishFailure(
        rejectedWithoutSaving: Bool, editRequiresRefresh: Bool = false
    ) throws {
        guard record.phase == .submitting else { return }
        var next = record
        switch next.kind {
        case .create:
            next.submissions.finish(rejectedWithoutSaving: rejectedWithoutSaving)
            next.phase = rejectedWithoutSaving ? .rejected : .uncertain
        case .edit:
            if rejectedWithoutSaving && !editRequiresRefresh {
                next.update = nil
                next.phase = .editing
            } else {
                next.phase = .requiresRefresh
            }
        }
        try persist(next)
    }

    public func reviseRejectedCreate() throws {
        guard record.kind == .create, record.phase == .rejected else { return }
        var next = record
        next.submissions.reviseRejectedDraft()
        next.phase = .editing
        try persist(next)
    }

    public func saveResult(_ task: VaultTask) throws {
        guard record.phase == .submitting || record.phase == .requiresRefresh,
              WatchTaskValidation.task(task) else {
            throw WatchFailure.invalidRequest
        }
        if record.kind == .edit {
            guard let source = record.source, let update = record.update,
                  task.id == source.id,
                  Self.matches(update: update, source: source, saved: task) else {
                throw WatchFailure.invalidRequest
            }
        }
        var next = record
        if next.kind == .create { next.submissions.confirmSaved() }
        next.savedTask = task
        next.phase = .saved
        try persist(next)
    }

    @discardableResult public func refreshEdit(with fresh: VaultTask) throws -> Bool {
        guard record.kind == .edit, record.phase == .requiresRefresh,
              let source = record.source, fresh.id == source.id,
              WatchTaskValidation.task(fresh) else {
            throw WatchFailure.invalidRequest
        }
        if let update = record.update, Self.matches(update: update, source: source, saved: fresh) {
            try saveResult(fresh)
            return true
        }
        var next = record
        next.source = fresh
        next.draft.fields.scope = fresh.scope
        next.update = nil
        next.phase = .editing
        next.reapplying = true
        try persist(next)
        return false
    }

    public func startAnotherCreate(selectedDue: Date = Date().addingTimeInterval(3_600)) throws {
        guard record.kind == .create, record.phase == .saved else { return }
        try persist(.init(createSelectedDue: selectedDue))
    }

    private func persist(_ next: WatchTaskEditorRecord) throws {
        try next.validate()
        try Self.write(next, to: fileURL)
        record = next
    }

    private static func read(_ url: URL) throws -> WatchTaskEditorRecord {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= maximumBytes else {
            throw WatchFailure.invalidRequest
        }
        return try WatchTaskEditorRecord.restore(from: Data(contentsOf: url))
    }

    private static func write(_ value: WatchTaskEditorRecord, to url: URL) throws {
        try value.validate()
        let data = try JSONEncoder().encode(value)
        guard data.count <= maximumBytes else { throw WatchFailure.invalidRequest }
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try data.write(to: url, options: .atomic)
    }

    private static func matches(
        update: WatchTaskUpdateRequest, source: VaultTask, saved: VaultTask
    ) -> Bool {
        saved.path == source.path && saved.line == source.line &&
            saved.text == update.fields.text.split(whereSeparator: \.isWhitespace).joined(separator: " ") &&
            saved.dueDate == update.fields.due &&
            saved.dueTime == update.fields.time &&
            saved.priority == update.fields.priority &&
            (saved.notes ?? "") == update.fields.notes &&
            saved.timeZone == (update.timeZone ?? source.timeZone) &&
            saved.remindAtDue == (update.fields.remindAtDue ?? source.remindAtDue)
    }
}
