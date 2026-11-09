import Foundation

public enum JarvisProactiveSourceID: String, CaseIterable, Codable, Sendable, Identifiable {
    case todos, calendar, mail, weather, factory, news, travel, x, health, nutrition, notes, memory

    public var id: String { rawValue }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .todos: .proactiveSourceTodos
        case .calendar: .proactiveSourceCalendar
        case .mail: .proactiveSourceMail
        case .weather: .proactiveSourceWeather
        case .factory: .proactiveSourceFactory
        case .news: .proactiveSourceNews
        case .travel: .proactiveSourceTravel
        case .x: .proactiveSourceX
        case .health: .proactiveSourceHealth
        case .nutrition: .proactiveSourceNutrition
        case .notes: .proactiveSourceNotes
        case .memory: .proactiveSourceMemory
        }
    }
}

public enum JarvisProactiveCategory: String, CaseIterable, Codable, Sendable, Identifiable {
    case deadline, clash, travel, todo, prep, news, weather, status, suggestion

    public var id: String { rawValue }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .deadline: .proactiveCategoryDeadline
        case .clash: .proactiveCategoryClash
        case .travel: .proactiveCategoryTravel
        case .todo: .proactiveCategoryTodo
        case .prep: .proactiveCategoryPrep
        case .news: .proactiveCategoryNews
        case .weather: .proactiveCategoryWeather
        case .status: .proactiveCategoryStatus
        case .suggestion: .proactiveCategorySuggestion
        }
    }
}

public enum JarvisProactiveUrgency: String, Codable, Sendable {
    case timeCritical = "time_critical"
    case normal
    case fyi

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .timeCritical: .proactiveUrgencyCritical
        case .normal: .proactiveUrgencyNormal
        case .fyi: .proactiveUrgencyFyi
        }
    }
}

public enum JarvisProactiveItemState: String, Codable, Sendable {
    case new, seen, dismissed, snoozed
}

public struct JarvisProactiveEvidence: Codable, Equatable, Sendable {
    public let source: String
    public let label: String
    public let observedAt: String
}

public struct JarvisProactiveItem: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: String
    public let title: String
    public let body: String
    public let category: JarvisProactiveCategory?
    public let urgency: JarvisProactiveUrgency
    public let dueAt: String?
    public let evidence: [JarvisProactiveEvidence]
    public let state: JarvisProactiveItemState
    public let snoozedUntil: String?
    public let todoAdded: Bool
    public let language: String?
    public let createdAt: String

    public init(
        id: String, kind: String = "finding", title: String, body: String,
        category: JarvisProactiveCategory? = nil, urgency: JarvisProactiveUrgency = .normal,
        dueAt: String? = nil, evidence: [JarvisProactiveEvidence] = [], state: JarvisProactiveItemState = .new,
        snoozedUntil: String? = nil, todoAdded: Bool = false, language: String? = nil, createdAt: String
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.category = category
        self.urgency = urgency
        self.dueAt = dueAt
        self.evidence = evidence
        self.state = state
        self.snoozedUntil = snoozedUntil
        self.todoAdded = todoAdded
        self.language = language
        self.createdAt = createdAt
    }

    var isValid: Bool {
        !id.isEmpty && title.count <= 200 && body.count <= 10_000 && evidence.count <= 50
            && (dueAt.map { JarvisInsightsDates.parse($0) != nil } ?? true)
            && JarvisInsightsDates.parse(createdAt) != nil
    }

    func with(state: JarvisProactiveItemState? = nil, todoAdded: Bool? = nil) -> JarvisProactiveItem {
        JarvisProactiveItem(
            id: id, kind: kind, title: title, body: body, category: category, urgency: urgency, dueAt: dueAt,
            evidence: evidence, state: state ?? self.state, snoozedUntil: snoozedUntil,
            todoAdded: todoAdded ?? self.todoAdded, language: language, createdAt: createdAt
        )
    }
}

public enum JarvisProactiveRunStatus: String, Codable, Sendable {
    case running, done, failed, skipped, cancelled

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .running: .proactiveRunRunning
        case .done: .proactiveRunDone
        case .failed: .proactiveRunFailed
        case .skipped: .proactiveRunSkipped
        case .cancelled: .proactiveRunCancelled
        }
    }
}

public struct JarvisProactiveRun: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let trigger: String
    public let slot: String?
    public let status: JarvisProactiveRunStatus
    public let reason: String?
    public let startedAt: String
    public let finishedAt: String?
    public let findingCount: Int

    public init(
        id: String, trigger: String = "scheduled", slot: String? = nil, status: JarvisProactiveRunStatus,
        reason: String? = nil, startedAt: String, finishedAt: String? = nil, findingCount: Int = 0
    ) {
        self.id = id
        self.trigger = trigger
        self.slot = slot
        self.status = status
        self.reason = reason
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.findingCount = findingCount
    }

    var isValid: Bool {
        ["scheduled", "catchup", "manual"].contains(trigger) && findingCount >= 0
            && JarvisInsightsDates.parse(startedAt) != nil
            && (finishedAt.map { JarvisInsightsDates.parse($0) != nil } ?? true)
    }

    /// When the run last did something: finished if it did, otherwise started.
    public var occurredAt: String { finishedAt ?? startedAt }
}

public struct JarvisProactiveSourceStatus: Codable, Equatable, Sendable, Identifiable {
    public let id: JarvisProactiveSourceID
    public let enabled: Bool
    public let state: String
    public let reason: String?
    public let observedAt: String?

    public init(id: JarvisProactiveSourceID, enabled: Bool, state: String, reason: String? = nil, observedAt: String? = nil) {
        self.id = id
        self.enabled = enabled
        self.state = state
        self.reason = reason
        self.observedAt = observedAt
    }
}

public enum JarvisProactiveBudgetState: String, Codable, Sendable {
    case ok, warn, exhausted

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .ok: .proactiveBudgetOk
        case .warn: .proactiveBudgetWarn
        case .exhausted: .proactiveBudgetExhausted
        }
    }
}

public struct JarvisProactiveBudget: Codable, Equatable, Sendable {
    public let month: String
    public let monthlyLimitDkk: Double
    public let estimatedSpendDkk: Double
    public let state: JarvisProactiveBudgetState

    public init(month: String, monthlyLimitDkk: Double, estimatedSpendDkk: Double, state: JarvisProactiveBudgetState) {
        self.month = month
        self.monthlyLimitDkk = monthlyLimitDkk
        self.estimatedSpendDkk = estimatedSpendDkk
        self.state = state
    }

    /// Share of the monthly limit already spent, 0 to 1. A zero limit counts as fully used.
    public var usedFraction: Double {
        guard monthlyLimitDkk > 0 else { return 1 }
        return min(1, max(0, estimatedSpendDkk / monthlyLimitDkk))
    }
}

public struct JarvisProactiveStatus: Codable, Equatable, Sendable {
    public let paused: Bool
    public let quietNow: Bool
    public let nextSlotAt: String?
    public let lastRun: JarvisProactiveRun?
    public let budget: JarvisProactiveBudget
    public let sources: [JarvisProactiveSourceStatus]

    public init(
        paused: Bool, quietNow: Bool, nextSlotAt: String?, lastRun: JarvisProactiveRun?,
        budget: JarvisProactiveBudget, sources: [JarvisProactiveSourceStatus]
    ) {
        self.paused = paused
        self.quietNow = quietNow
        self.nextSlotAt = nextSlotAt
        self.lastRun = lastRun
        self.budget = budget
        self.sources = sources
    }

    var isValid: Bool {
        (nextSlotAt.map { JarvisInsightsDates.parse($0) != nil } ?? true)
            && (lastRun?.isValid ?? true)
            && budget.monthlyLimitDkk.isFinite && budget.monthlyLimitDkk >= 0
            && budget.estimatedSpendDkk.isFinite && budget.estimatedSpendDkk >= 0
            && Set(sources.map(\.id)).count == sources.count
    }
}

public enum JarvisProactiveScope: String, CaseIterable, Codable, Sendable, Identifiable {
    case all, personal, work

    public var id: String { rawValue }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .all: .editorScopeAll
        case .personal: .editorScopePersonal
        case .work: .editorScopeWork
        }
    }
}

public struct JarvisProactiveToggle<ID: Codable & Hashable & Sendable>: Codable, Equatable, Sendable {
    public let id: ID
    public var enabled: Bool

    public init(id: ID, enabled: Bool) {
        self.id = id
        self.enabled = enabled
    }
}

public struct JarvisProactiveConfig: Decodable, Equatable, Sendable {
    public let paused: Bool
    public let monthlyBudgetDkk: Int
    public let sources: [JarvisProactiveToggle<JarvisProactiveSourceID>]
    public let categories: [JarvisProactiveToggle<JarvisProactiveCategory>]
    public let suggestionScope: JarvisProactiveScope
    public let newsFeeds: [String]
    public let guidance: String
    public let revision: String
    public let preferences: [String]

    public init(
        paused: Bool = false,
        monthlyBudgetDkk: Int = 50,
        sources: [JarvisProactiveToggle<JarvisProactiveSourceID>]? = nil,
        categories: [JarvisProactiveToggle<JarvisProactiveCategory>]? = nil,
        suggestionScope: JarvisProactiveScope = .all,
        newsFeeds: [String] = [],
        guidance: String = "",
        revision: String = String(repeating: "a", count: 64),
        preferences: [String] = []
    ) {
        self.paused = paused
        self.monthlyBudgetDkk = monthlyBudgetDkk
        self.sources = sources ?? JarvisProactiveSourceID.allCases.map { JarvisProactiveToggle(id: $0, enabled: true) }
        self.categories = categories ?? JarvisProactiveCategory.allCases.map { JarvisProactiveToggle(id: $0, enabled: true) }
        self.suggestionScope = suggestionScope
        self.newsFeeds = newsFeeds
        self.guidance = guidance
        self.revision = revision
        self.preferences = preferences
    }

    var isValid: Bool {
        JarvisProactiveLimits.budgetRange.contains(monthlyBudgetDkk)
            && Set(sources.map(\.id)).count == sources.count
            && categories.count == JarvisProactiveCategory.allCases.count
            && Set(categories.map(\.id)).count == categories.count
            && newsFeeds.allSatisfy { $0.count <= JarvisProactiveLimits.feedLength }
            && guidance.count <= JarvisProactiveLimits.guidanceLength
            && revision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            && preferences.count <= JarvisProactiveLimits.preferenceCount
            && preferences.allSatisfy { $0.count <= JarvisProactiveLimits.preferenceLength }
    }
}

public enum JarvisProactiveLimits {
    public static let budgetRange = 0...1_000
    public static let guidanceLength = 1_000
    public static let preferenceCount = 12
    public static let preferenceLength = 300
    public static let feedCount = 10
    public static let feedLength = 300
}

/// Only the fields that changed. Fields left `nil` are not sent, so the backend keeps its values.
public struct JarvisProactiveSettingsPatch: Encodable, Equatable, Sendable {
    public var paused: Bool?
    public var monthlyBudgetDkk: Int?
    public var sources: [JarvisProactiveToggle<JarvisProactiveSourceID>]?
    public var categories: [JarvisProactiveToggle<JarvisProactiveCategory>]?
    public var suggestionScope: JarvisProactiveScope?
    public var newsFeeds: [String]?
    public var guidance: String?
    public let expectedRevision: String

    public var isEmpty: Bool {
        paused == nil && monthlyBudgetDkk == nil && sources == nil && categories == nil
            && suggestionScope == nil && newsFeeds == nil && guidance == nil
    }
}

public enum JarvisProactiveIssue: Equatable, Sendable {
    case budgetOutOfRange
    case guidanceTooLong
    case invalidFeed
    case tooManyFeeds
    case tooManyPreferences

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .budgetOutOfRange: .editorIssueBudget
        case .guidanceTooLong: .editorIssueGuidance
        case .invalidFeed, .tooManyFeeds: .editorIssueFeeds
        case .tooManyPreferences: .editorIssuePreferences
        }
    }
}

/// The values being edited. Budget and feeds stay as text while typing and are checked before they are saved.
public struct JarvisProactiveSettingsDraft: Equatable, Sendable {
    public var paused: Bool
    public var budgetText: String
    public var sources: [JarvisProactiveToggle<JarvisProactiveSourceID>]
    public var categories: [JarvisProactiveToggle<JarvisProactiveCategory>]
    public var scope: JarvisProactiveScope
    public var feedsText: String
    public var guidance: String
    public var preferences: [String]

    public init(_ settings: JarvisProactiveConfig) {
        paused = settings.paused
        budgetText = String(settings.monthlyBudgetDkk)
        sources = settings.sources
        categories = settings.categories
        scope = settings.suggestionScope
        feedsText = settings.newsFeeds.joined(separator: "\n")
        guidance = settings.guidance
        preferences = settings.preferences
    }

    public var budget: Int? {
        let trimmed = budgetText.trimmingCharacters(in: .whitespaces)
        guard let value = Int(trimmed), JarvisProactiveLimits.budgetRange.contains(value) else { return nil }
        return value
    }

    public var feeds: [String] {
        feedsText.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    static func isValidFeed(_ value: String) -> Bool {
        guard value.count <= JarvisProactiveLimits.feedLength,
              let components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return false }
        return true
    }

    public var issues: [JarvisProactiveIssue] {
        var result: [JarvisProactiveIssue] = []
        if budget == nil { result.append(.budgetOutOfRange) }
        if guidance.count > JarvisProactiveLimits.guidanceLength { result.append(.guidanceTooLong) }
        let feeds = feeds
        if feeds.count > JarvisProactiveLimits.feedCount { result.append(.tooManyFeeds) }
        if !feeds.allSatisfy(Self.isValidFeed) { result.append(.invalidFeed) }
        if preferences.count > JarvisProactiveLimits.preferenceCount { result.append(.tooManyPreferences) }
        return result
    }

    public var isValid: Bool { issues.isEmpty }

    /// The smallest patch that turns `settings` into this draft; `nil` when the draft is invalid.
    public func patch(from settings: JarvisProactiveConfig) -> JarvisProactiveSettingsPatch? {
        guard isValid, let budget else { return nil }
        var patch = JarvisProactiveSettingsPatch(expectedRevision: settings.revision)
        if paused != settings.paused { patch.paused = paused }
        if budget != settings.monthlyBudgetDkk { patch.monthlyBudgetDkk = budget }
        let changedSources = sources.filter { toggle in
            settings.sources.first { $0.id == toggle.id }?.enabled != toggle.enabled
        }
        if !changedSources.isEmpty { patch.sources = changedSources }
        let changedCategories = categories.filter { toggle in
            settings.categories.first { $0.id == toggle.id }?.enabled != toggle.enabled
        }
        if !changedCategories.isEmpty { patch.categories = changedCategories }
        if scope != settings.suggestionScope { patch.suggestionScope = scope }
        if feeds != settings.newsFeeds { patch.newsFeeds = feeds }
        if guidance != settings.guidance { patch.guidance = guidance }
        return patch
    }
}

public enum JarvisProactiveSaveState: Equatable, Sendable {
    case idle
    case saving
    case saved
    case failed(JarvisInsightsFailure)
}

/// The settings editor: edits stay in the draft until a save succeeds; a failed save keeps them and can be retried.
public struct JarvisProactiveSettingsEditor: Equatable, Sendable {
    public private(set) var saved: JarvisProactiveConfig
    public var draft: JarvisProactiveSettingsDraft
    public private(set) var state: JarvisProactiveSaveState = .idle

    public init(settings: JarvisProactiveConfig) {
        saved = settings
        draft = JarvisProactiveSettingsDraft(settings)
    }

    public var isDirty: Bool { draft != JarvisProactiveSettingsDraft(saved) }
    public var canConfirm: Bool { state != .saving && draft.isValid && isDirty }
    public var canRetry: Bool {
        if case .failed = state { return draft.isValid }
        return false
    }

    /// Starts a save. Returns the patch to send, or `nil` when there is nothing valid to save.
    public mutating func beginSave() -> JarvisProactiveSettingsPatch? {
        guard state != .saving, let patch = draft.patch(from: saved), !patch.isEmpty else { return nil }
        state = .saving
        return patch
    }

    public mutating func saveSucceeded(_ settings: JarvisProactiveConfig) {
        saved = settings
        draft = JarvisProactiveSettingsDraft(settings)
        state = .saved
    }

    public mutating func saveFailed(_ error: Error) {
        state = .failed(JarvisInsightsFailure(error))
    }

    /// After a conflict: adopt the newer saved values and revision but keep what was typed.
    public mutating func rebase(onto settings: JarvisProactiveConfig) {
        saved = settings
        if case .failed(.conflict) = state { state = .idle }
    }

    public mutating func discard() {
        draft = JarvisProactiveSettingsDraft(saved)
        state = .idle
    }
}

public enum JarvisProactiveStatusLine: Equatable, Sendable {
    case checking
    case paused
    case quietHours(next: Date?)
    case nextCheck(Date)
    case none
}

public enum JarvisProactiveLogic {
    /// Status and open items refresh this often while the page is visible.
    public static let refreshInterval = Duration.seconds(10)

    /// The next-check sentence: a running check wins, then paused, then quiet hours, then the next slot.
    public static func statusLine(_ status: JarvisProactiveStatus) -> JarvisProactiveStatusLine {
        if status.lastRun?.status == .running { return .checking }
        let next = status.nextSlotAt.flatMap(JarvisInsightsDates.parse)
        if status.paused { return .paused }
        if status.quietNow { return .quietHours(next: next) }
        if let next { return .nextCheck(next) }
        return .none
    }

    /// "Check now" is refused by the backend while paused or out of budget, so the button follows suit.
    public static func canCheckNow(_ status: JarvisProactiveStatus) -> Bool {
        !status.paused && status.budget.state != .exhausted && status.lastRun?.status != .running
    }

    /// Tomorrow 07:00 Danish time, the only snooze the page offers.
    public static func tomorrowAtSeven(after now: Date) -> Date {
        let calendar = JarvisInsightsDates.calendar
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) ?? today.addingTimeInterval(86_400)
        return calendar.date(bySettingHour: 7, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }

    public static func snoozeTimestamp(now: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: tomorrowAtSeven(after: now))
    }

    public static func sourceReason(_ code: String?) -> JarvisInsightsLocalizationKey {
        switch code {
        case "not_connected": .proactiveReasonNotConnected
        case "not_authorised": .proactiveReasonNotAuthorised
        case "rate_limited": .proactiveReasonRateLimited
        case "timeout": .proactiveReasonTimeout
        case "read_failed": .proactiveReasonReadFailed
        case "too_large": .proactiveReasonTooLarge
        case "no_location": .proactiveReasonNoLocation
        case "todo_file_missing": .proactiveReasonTodoMissing
        case "todo_file_ambiguous": .proactiveReasonTodoAmbiguous
        case "no_provider": .proactiveReasonNoProvider
        case "invalid_feed": .proactiveReasonInvalidFeed
        case "no_feeds": .proactiveReasonNoFeeds
        case "some_feeds_failed": .proactiveReasonSomeFeedsFailed
        default: .proactiveReasonUnknown
        }
    }

    /// The task a proactive item turns into: its title, with the due time when it has one.
    public static func taskDraft(for item: JarvisProactiveItem) -> (text: String, due: String?, time: String?) {
        let title = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let due = item.dueAt.flatMap(JarvisInsightsDates.parse) else { return (title, nil, nil) }
        let parts = JarvisInsightsDates.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: due)
        let day = String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        let time = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        return (title, day, time)
    }

    /// Items that are no longer open: everything returned for "all" that the open list does not contain.
    public static func earlier(all: [JarvisProactiveItem], open: [JarvisProactiveItem]) -> [JarvisProactiveItem] {
        let openIDs = Set(open.map(\.id))
        return all.filter { !openIDs.contains($0.id) }
    }
}

public enum JarvisProactiveItemAction: Sendable {
    case seen
    case dismiss
    case snooze(until: String)
}

public final class JarvisProactiveClient: Sendable {
    private let client: JarvisClient
    private static let responseLimit = 2 * 1024 * 1024

    public init(client: JarvisClient) {
        self.client = client
    }

    /// A 404 means the feature is unavailable and surfaces as `JarvisInsightsFailure.unavailable`.
    public func status() async throws -> JarvisProactiveStatus {
        let value: JarvisProactiveStatus = try await get(["proactive", "status"])
        guard value.isValid else { throw JarvisInsightsError.invalidResponse }
        return value
    }

    /// Conditional reads for the repository layer. Validation matches the plain reads below.
    public func fetchStatus(validator: String?) async throws -> JarvisFetchResult<JarvisProactiveStatus> {
        try await client.conditionalGet(path: ["proactive", "status"], validator: validator) {
            let value: JarvisProactiveStatus = try self.decode($0)
            guard value.isValid else { throw JarvisInsightsError.invalidResponse }
            return value
        }
    }

    /// Selects the trusted finding as conversation context without sending a chat message.
    public func openConversation(id: String) async throws {
        guard UUID(uuidString: id) != nil else { throw JarvisInsightsError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .post, path: ["proactive", "items", id, "conversation"],
            body: Data("{}".utf8), idempotent: true
        )
        guard response.statusCode == 204 else { throw JarvisInsightsError.invalidResponse }
    }

    public func item(id: String) async throws -> JarvisProactiveItem {
        guard UUID(uuidString: id) != nil else { throw JarvisInsightsError.invalidRequest }
        let value: JarvisProactiveItem = try await get(["proactive", "items", id])
        guard value.isValid, value.id.lowercased() == id.lowercased() else { throw JarvisInsightsError.invalidResponse }
        return value
    }

    public func fetchItems(validator: String?) async throws -> JarvisFetchResult<[JarvisProactiveItem]> {
        try await client.conditionalGet(
            path: ["proactive", "items"],
            queryItems: [URLQueryItem(name: "state", value: "open")],
            validator: validator
        ) {
            let envelope: ItemsEnvelope = try self.decode($0)
            guard envelope.items.count <= 100, envelope.items.allSatisfy(\.isValid) else {
                throw JarvisInsightsError.invalidResponse
            }
            return envelope.items
        }
    }

    public func fetchRuns(validator: String?) async throws -> JarvisFetchResult<[JarvisProactiveRun]> {
        try await client.conditionalGet(
            path: ["proactive", "runs"],
            queryItems: [URLQueryItem(name: "limit", value: "10")],
            validator: validator
        ) {
            let envelope: RunsEnvelope = try self.decode($0)
            guard envelope.runs.allSatisfy(\.isValid) else { throw JarvisInsightsError.invalidResponse }
            return envelope.runs
        }
    }

    public func items(all: Bool) async throws -> [JarvisProactiveItem] {
        let envelope: ItemsEnvelope = try await get(
            ["proactive", "items"],
            query: [URLQueryItem(name: "state", value: all ? "all" : "open")]
        )
        guard envelope.items.count <= 100, envelope.items.allSatisfy(\.isValid) else {
            throw JarvisInsightsError.invalidResponse
        }
        return envelope.items
    }

    public func runs(limit: Int = 10) async throws -> [JarvisProactiveRun] {
        guard (1...50).contains(limit) else { throw JarvisInsightsError.invalidRequest }
        let envelope: RunsEnvelope = try await get(
            ["proactive", "runs"],
            query: [URLQueryItem(name: "limit", value: String(limit))]
        )
        guard envelope.runs.allSatisfy(\.isValid) else { throw JarvisInsightsError.invalidResponse }
        return envelope.runs
    }

    /// Starts a manual check. Not idempotent, so it is never retried automatically.
    public func checkNow() async throws {
        _ = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["proactive", "runs"],
            idempotent: false,
            additionalSuccessStatuses: [202]
        )
    }

    public func settings() async throws -> JarvisProactiveConfig {
        let value: JarvisProactiveConfig = try await get(["proactive", "settings"])
        guard value.isValid else { throw JarvisInsightsError.invalidResponse }
        return value
    }

    public func updateSettings(_ patch: JarvisProactiveSettingsPatch) async throws -> JarvisProactiveConfig {
        guard !patch.isEmpty else { throw JarvisInsightsError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .patch,
            path: ["proactive", "settings"],
            body: try JSONEncoder().encode(patch),
            idempotent: false
        )
        let value: JarvisProactiveConfig = try decode(response)
        guard value.isValid else { throw JarvisInsightsError.invalidResponse }
        return value
    }

    public func apply(_ action: JarvisProactiveItemAction, to itemID: String) async throws -> JarvisProactiveItem {
        let body: [String: String]
        switch action {
        case .seen: body = ["action": "seen"]
        case .dismiss: body = ["action": "dismiss"]
        case .snooze(let until): body = ["action": "snooze", "snoozeUntil": until]
        }
        guard let encodedID = itemID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              !itemID.contains("/") else { throw JarvisInsightsError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["proactive", "items", encodedID, "feedback"],
            body: try JSONEncoder().encode(body),
            idempotent: true
        )
        let item: JarvisProactiveItem = try decode(response)
        guard item.isValid else { throw JarvisInsightsError.invalidResponse }
        return item
    }

    private struct ItemsEnvelope: Decodable { let items: [JarvisProactiveItem] }
    private struct RunsEnvelope: Decodable { let runs: [JarvisProactiveRun] }

    private func get<Value: Decodable>(_ path: [String], query: [URLQueryItem] = []) async throws -> Value {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: path,
            queryItems: query,
            idempotent: true
        )
        return try decode(response)
    }

    private func decode<Value: Decodable>(_ response: HTTPResponse) throws -> Value {
        guard response.statusCode == 200, response.body.count <= Self.responseLimit,
              let value = try? JSONDecoder().decode(Value.self, from: response.body) else {
            throw JarvisInsightsError.invalidResponse
        }
        return value
    }
}
