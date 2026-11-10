import Foundation

public enum WatchTaskMode: String, Codable, Equatable, Sendable {
    case auto, manual
}

public struct WatchTaskFields: Codable, Equatable, Sendable {
    public var text: String
    public var scope: VaultTaskScope
    public var due: String?
    public var time: String?
    public var priority: VaultTask.Priority
    public var notes: String

    public init(
        text: String = "", scope: VaultTaskScope = .personal, due: String? = nil,
        time: String? = nil, priority: VaultTask.Priority = .normal, notes: String = ""
    ) {
        self.text = text; self.scope = scope; self.due = due
        self.time = time; self.priority = priority; self.notes = notes
    }

    public var validationMessage: String? {
        if !WatchTaskValidation.text(text, maximum: 400, minimum: 2) {
            return "Enter a title of 2–400 characters without control characters."
        }
        if let due, !WatchTaskValidation.date(due) { return "Choose a valid due date." }
        if let time, !WatchTaskValidation.time(time) { return "Choose a valid due time." }
        if time != nil && due == nil { return "Choose a date for the due time." }
        if !WatchTaskValidation.text(notes, maximum: 2_000, minimum: 0) {
            return "Keep notes within 2,000 characters without control characters."
        }
        return nil
    }
}

/// Both modes keep their own entered content. No identity or default date is allocated by editing.
public struct WatchTaskDraft: Equatable, Sendable {
    public var mode: WatchTaskMode = .auto
    public var input = ""
    public var fields = WatchTaskFields()
    public init() {}

    public var validationMessage: String? {
        mode == .manual ? fields.validationMessage :
            (WatchTaskValidation.text(input, maximum: 2_000, minimum: 1) ? nil :
                "Describe one task in 1–2,000 characters without control characters.")
    }
}

public struct WatchTaskCreateRequest: Codable, Equatable, Sendable {
    public let submissionId: String
    public let submittedAt: String
    public let timeZone: String
    public let mode: WatchTaskMode
    public let input: String?
    public let fields: WatchTaskFields?

    public init(draft: WatchTaskDraft, id: UUID, submittedAt: Date, timeZone: TimeZone) {
        submissionId = id.uuidString.lowercased()
        self.submittedAt = ISO8601DateFormatter().string(from: submittedAt)
        self.timeZone = WatchTaskValidation.identifier(timeZone)
        mode = draft.mode
        input = mode == .auto ? draft.input : nil
        fields = mode == .manual ? draft.fields : nil
    }

    public var isValid: Bool {
        submissionId.range(of: #"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#,
                           options: [.regularExpression, .caseInsensitive]) != nil &&
            ISO8601DateFormatter().date(from: submittedAt) != nil &&
            WatchTaskValidation.timeZone(timeZone) &&
            (mode == .auto
                ? (input.map { WatchTaskValidation.text($0, maximum: 2_000, minimum: 1) } == true && fields == nil)
                : (input == nil && fields != nil && fields?.validationMessage == nil))
    }
}

public struct WatchTaskUpdateRequest: Codable, Equatable, Sendable {
    public let path: String
    public let line: Int
    public let text: String
    public let version: String
    public let timeZone: String?
    public let fields: Fields

    public struct Fields: Codable, Equatable, Sendable {
        public let text: String
        public let due: String?
        public let time: String?
        public let priority: VaultTask.Priority
        public let notes: String
        public let remindAtDue: Bool?

        private enum CodingKeys: String, CodingKey { case text, due, time, priority, notes, remindAtDue }
        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(text, forKey: .text)
            try container.encode(due, forKey: .due)
            try container.encode(time, forKey: .time)
            try container.encode(priority, forKey: .priority)
            try container.encode(notes, forKey: .notes)
            try container.encodeIfPresent(remindAtDue, forKey: .remindAtDue)
        }
    }

    public init(task: VaultTask, fields: WatchTaskFields, timeZone: TimeZone?, remindAtDue: Bool? = nil) {
        path = task.path; line = task.line; text = task.text; version = task.version
        let scheduleChanged = fields.due != task.dueDate || fields.time != task.dueTime
        self.timeZone = scheduleChanged ? timeZone.map(WatchTaskValidation.identifier) : task.timeZone
        self.fields = .init(text: fields.text, due: fields.due, time: fields.time,
                            priority: fields.priority, notes: fields.notes,
                            remindAtDue: remindAtDue ?? task.remindAtDue)
    }

    public var isValid: Bool {
        JarvisNotesLogic.validNotePath(path) && (1...1_000_000).contains(line) &&
            WatchTaskValidation.fingerprint(version) &&
            WatchTaskValidation.text(text, maximum: 400, minimum: 1) &&
            (timeZone.map(WatchTaskValidation.timeZone) ?? true) &&
            (fields.remindAtDue != true || (fields.due != nil && fields.time != nil && fields.priority == .high)) &&
            WatchTaskFields(text: fields.text, due: fields.due, time: fields.time,
                            priority: fields.priority, notes: fields.notes).validationMessage == nil
    }
}

public enum WatchTaskSubmissionError: Error, Equatable {
    case sending, invalidDraft, changedPayload
}

/// Partial pages never masquerade as an empty or complete Today list.
public struct WatchTaskPageCollection: Sendable {
    public private(set) var tasks: [VaultTask] = []
    public private(set) var nextOffset: Int? = 0
    public private(set) var dayStart: Date?
    public private(set) var timeZoneID: String?
    private var totalCount: Int?
    public init() {}

    public mutating func append(_ page: WatchTaskPage) throws {
        guard nextOffset == page.offset, (0...500).contains(page.totalCount),
              page.tasks.count <= 20, page.offset + page.tasks.count <= page.totalCount,
              page.tasks.allSatisfy(WatchTaskValidation.task),
              TimeZone(identifier: page.timeZoneID) != nil,
              try JSONEncoder().encode(page).count <= WatchLimits.payloadBytes,
              totalCount.map({ $0 == page.totalCount }) ?? true,
              dayStart.map({ $0 == page.dayStart }) ?? true,
              timeZoneID.map({ $0 == page.timeZoneID }) ?? true else { throw WatchFailure.failed }
        let next = page.offset + page.tasks.count
        guard page.nextOffset == (next < page.totalCount ? next : nil),
              page.nextOffset == nil || !page.tasks.isEmpty,
              Set((tasks + page.tasks).map(\.id)).count == tasks.count + page.tasks.count else {
            throw WatchFailure.failed
        }
        totalCount = page.totalCount; dayStart = page.dayStart; timeZoneID = page.timeZoneID
        tasks.append(contentsOf: page.tasks); nextOffset = page.nextOffset
    }
}

/// A lost acknowledgement must not turn a changed form into a second create.
public struct WatchTaskSubmissionState: Sendable {
    public private(set) var request: WatchTaskCreateRequest?
    public private(set) var sending = false
    public private(set) var canRevise = false
    private var submittedDraft: WatchTaskDraft?
    public init() {}

    public mutating func begin(
        _ draft: WatchTaskDraft, now: Date = Date(), timeZone: TimeZone = .current,
        makeID: () -> UUID = UUID.init
    ) throws -> WatchTaskCreateRequest {
        guard !sending else { throw WatchTaskSubmissionError.sending }
        guard draft.validationMessage == nil else { throw WatchTaskSubmissionError.invalidDraft }
        if let request {
            guard submittedDraft == draft else { throw WatchTaskSubmissionError.changedPayload }
            sending = true
            return request
        }
        let value = WatchTaskCreateRequest(draft: draft, id: makeID(), submittedAt: now, timeZone: timeZone)
        guard value.isValid else { throw WatchTaskSubmissionError.invalidDraft }
        request = value; submittedDraft = draft; sending = true; canRevise = false
        return value
    }

    public mutating func finish(rejectedWithoutSaving: Bool = false) {
        sending = false
        canRevise = rejectedWithoutSaving
    }

    public mutating func reviseRejectedDraft() {
        guard !sending, canRevise else { return }
        request = nil; submittedDraft = nil; canRevise = false
    }
}

public enum WatchTaskValidation {
    public static let requestBytes = 16 * 1024
    public static let responseBytes = 24 * 1024

    static func text(_ value: String, maximum: Int, minimum: Int) -> Bool {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let scalars = value.unicodeScalars
        return clean.unicodeScalars.count >= minimum && scalars.count <= maximum &&
            !scalars.contains { scalar in
                (CharacterSet.controlCharacters.contains(scalar) && !"\n\r\t".unicodeScalars.contains(scalar)) ||
                    scalar.properties.generalCategory == .format
            }
    }
    static func fingerprint(_ value: String) -> Bool {
        value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }
    static func date(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        return formatter.date(from: value).map { formatter.string(from: $0) == value } ?? false
    }
    static func time(_ value: String) -> Bool {
        value.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    }
    static func timeZone(_ value: String) -> Bool {
        value.utf8.count <= 100 && TimeZone(identifier: value) != nil &&
            value.range(of: #"^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+)$"#, options: .regularExpression) != nil
    }
    static func identifier(_ zone: TimeZone) -> String {
        ["GMT", "Etc/UTC", "Etc/GMT"].contains(zone.identifier) ? "UTC" : zone.identifier
    }
    static func instant(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value) != nil
    }
    public static func task(_ value: VaultTask) -> Bool {
        fingerprint(value.id) && fingerprint(value.version) && JarvisNotesLogic.validNotePath(value.path) &&
            (1...1_000_000).contains(value.line) && text(value.text, maximum: 400, minimum: 1) &&
            (value.dueDate.map(date) ?? true) && (value.dueTime.map(time) ?? true) &&
            (value.dueAt.map(instant) ?? true) &&
            (value.notes.map { text($0, maximum: 2_000, minimum: 0) } ?? true) &&
            (value.timeZone.map(timeZone) ?? true)
    }
}

public extension VaultTask.Priority {
    var watchLabel: String {
        switch self { case .normal: "Low"; case .medium: "Medium"; case .high: "High" }
    }
}

public extension VaultTask {
    var watchReminderLabel: String? {
        remindAtDue.map { $0 ? "At due time" : "Default timing" }
    }
}

public extension WatchRequest {
    var createWatchTaskRequest: WatchTaskCreateRequest? {
        guard action == .createWatchTask, text == nil, itemID == nil, flag == nil,
              let data, data.count <= WatchTaskValidation.requestBytes,
              let value = try? JSONDecoder().decode(WatchTaskCreateRequest.self, from: data),
              value.isValid, UUID(uuidString: value.submissionId) == id else { return nil }
        return value
    }

    var updateWatchTaskRequest: WatchTaskUpdateRequest? {
        guard action == .updateWatchTask, text == nil, flag == nil,
              itemID.map(WatchTaskValidation.fingerprint) == true,
              let data, data.count <= WatchTaskValidation.requestBytes,
              let value = try? JSONDecoder().decode(WatchTaskUpdateRequest.self, from: data),
              value.isValid else { return nil }
        return value
    }

    var completionWatchTask: VaultTask? {
        guard action == .completeWatchTask, text == nil, flag != nil,
              let data, data.count <= WatchTaskValidation.responseBytes,
              let value = try? JSONDecoder().decode(VaultTask.self, from: data),
              value.id == itemID, WatchTaskValidation.task(value) else { return nil }
        return value
    }
}
