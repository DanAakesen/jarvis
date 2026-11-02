import Foundation

public enum JarvisStatusValue: String, Decodable, CaseIterable, Sendable {
    case ok
    case degraded
    case down
    case unknown

    /// Problems sort first: failing, then degraded, then unknown, then OK.
    var rank: Int {
        switch self {
        case .down: 0
        case .degraded: 1
        case .unknown: 2
        case .ok: 3
        }
    }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .ok: .statusOk
        case .degraded: .statusDegraded
        case .down: .statusDown
        case .unknown: .statusUnknown
        }
    }
}

public enum JarvisStatusCheckID: String, CaseIterable, Sendable {
    case database
    case foundryChat = "foundry.chat"
    case foundryVoice = "foundry.voice"
    case foundryEmbeddings = "foundry.embeddings"
    case vaultIndex = "vault_index"
    case githubApp = "github_app"
    case google
    case pcBridge = "pc_bridge"
    case runner
    case deployedCommit = "deployed_commit"
    case lastError = "last_error"

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .database: .statusCheckDatabase
        case .foundryChat: .statusCheckChat
        case .foundryVoice: .statusCheckVoice
        case .foundryEmbeddings: .statusCheckEmbeddings
        case .vaultIndex: .statusCheckVault
        case .githubApp: .statusCheckGitHub
        case .google: .statusCheckGoogle
        case .pcBridge: .statusCheckBridge
        case .runner: .statusCheckRunner
        case .deployedCommit: .statusCheckCommit
        case .lastError: .statusCheckError
        }
    }
}

public struct JarvisStatusEntry: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let status: JarvisStatusValue
    public let checkedAt: String
    public let details: [String: JSONValue]?

    public init(id: String, status: JarvisStatusValue, checkedAt: String, details: [String: JSONValue]? = nil) {
        self.id = id
        self.status = status
        self.checkedAt = checkedAt
        self.details = details
    }

    public var check: JarvisStatusCheckID? { JarvisStatusCheckID(rawValue: id) }
}

public struct JarvisStatusSmokeEntry: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let status: JarvisStatusValue
    public let checkedAt: String
    public let reason: String?

    public init(id: String, status: JarvisStatusValue, checkedAt: String, reason: String? = nil) {
        self.id = id
        self.status = status
        self.checkedAt = checkedAt
        self.reason = reason
    }
}

public struct JarvisStatusSmoke: Decodable, Equatable, Sendable {
    public let checkedAt: String
    public let entries: [JarvisStatusSmokeEntry]

    public init(checkedAt: String, entries: [JarvisStatusSmokeEntry]) {
        self.checkedAt = checkedAt
        self.entries = entries
    }

    public var okCount: Int { entries.filter { $0.status == .ok }.count }
}

public enum JarvisVaultMirrorState: String, Decodable, Sendable {
    case notSetUp = "not-set-up"
    case healthy
    case stale
    case needsAttention = "needs-attention"
    case failed
    case readError = "read-error"

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .notSetUp: .statusMirrorNotSetUp
        case .healthy: .statusMirrorHealthy
        case .stale: .statusMirrorStale
        case .needsAttention: .statusMirrorNeedsAttention
        case .failed: .statusMirrorFailed
        case .readError: .statusMirrorReadError
        }
    }

    /// The tone the row shares with the check rows.
    public var tone: JarvisStatusValue {
        switch self {
        case .healthy: .ok
        case .stale, .needsAttention: .degraded
        case .failed, .readError: .down
        case .notSetUp: .unknown
        }
    }
}

public struct JarvisVaultMirrorCounts: Decodable, Equatable, Sendable {
    public let approved: Int
    public let pushed: Int
    public let writtenBack: Int
    public let deleted: Int
    public let conflicts: Int
    public let skipped: Int
    public let credentialMatches: Int
    public let pendingWriteBack: Int
    public let consecutiveFailures: Int

    public init(
        approved: Int = 0, pushed: Int = 0, writtenBack: Int = 0, deleted: Int = 0, conflicts: Int = 0,
        skipped: Int = 0, credentialMatches: Int = 0, pendingWriteBack: Int = 0, consecutiveFailures: Int = 0
    ) {
        self.approved = approved
        self.pushed = pushed
        self.writtenBack = writtenBack
        self.deleted = deleted
        self.conflicts = conflicts
        self.skipped = skipped
        self.credentialMatches = credentialMatches
        self.pendingWriteBack = pendingWriteBack
        self.consecutiveFailures = consecutiveFailures
    }

    /// Label key and value pairs in display order.
    public var rows: [(JarvisInsightsLocalizationKey, Int)] {
        [
            (.statusMirrorApproved, approved), (.statusMirrorPushed, pushed),
            (.statusMirrorWrittenBack, writtenBack), (.statusMirrorDeleted, deleted),
            (.statusMirrorConflicts, conflicts), (.statusMirrorSkipped, skipped),
            (.statusMirrorCredentialMatches, credentialMatches),
            (.statusMirrorPendingWriteBack, pendingWriteBack),
            (.statusMirrorConsecutiveFailures, consecutiveFailures),
        ]
    }
}

public struct JarvisVaultMirror: Decodable, Equatable, Sendable {
    public let state: JarvisVaultMirrorState
    public let lastSuccessAt: String?
    public let writeBack: String?
    public let reason: String?
    public let counts: JarvisVaultMirrorCounts?
    public let conflictPaths: [String]?

    public init(
        state: JarvisVaultMirrorState,
        lastSuccessAt: String? = nil,
        writeBack: String? = nil,
        reason: String? = nil,
        counts: JarvisVaultMirrorCounts? = nil,
        conflictPaths: [String]? = nil
    ) {
        self.state = state
        self.lastSuccessAt = lastSuccessAt
        self.writeBack = writeBack
        self.reason = reason
        self.counts = counts
        self.conflictPaths = conflictPaths
    }

    public static let conflictPathLimit = 10
    public static let staleAfter: TimeInterval = 30 * 60

    /// A healthy mirror whose last success is older than 30 minutes is shown as stale.
    public func displayState(now: Date) -> JarvisVaultMirrorState {
        guard state == .healthy, let last = lastSuccessAt.flatMap(JarvisInsightsDates.parse),
              now.timeIntervalSince(last) > Self.staleAfter else { return state }
        return .stale
    }

    public var visibleConflictPaths: [String] {
        Array((conflictPaths ?? []).prefix(Self.conflictPathLimit))
    }
}

public struct JarvisStatusSnapshot: Decodable, Equatable, Sendable {
    public let checkedAt: String
    public let entries: [JarvisStatusEntry]
    public let smoke: JarvisStatusSmoke?
    public let vaultMirror: JarvisVaultMirror?

    public init(
        checkedAt: String,
        entries: [JarvisStatusEntry],
        smoke: JarvisStatusSmoke? = nil,
        vaultMirror: JarvisVaultMirror? = nil
    ) {
        self.checkedAt = checkedAt
        self.entries = entries
        self.smoke = smoke
        self.vaultMirror = vaultMirror
    }

    public static let checkCount = JarvisStatusCheckID.allCases.count

    /// All 11 checks present once, with valid timestamps, as the web page requires.
    public var isValid: Bool {
        JarvisInsightsDates.parse(checkedAt) != nil
            && entries.count == Self.checkCount
            && Set(entries.map(\.id)).count == Self.checkCount
            && entries.allSatisfy { $0.check != nil && JarvisInsightsDates.parse($0.checkedAt) != nil }
            && (smoke.map { $0.entries.count <= 32 && JarvisInsightsDates.parse($0.checkedAt) != nil } ?? true)
    }
}

public enum JarvisStatusFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case issues

    public var id: String { rawValue }

    public var localizationKey: JarvisInsightsLocalizationKey {
        self == .all ? .statusFilterAll : .statusFilterIssues
    }
}

/// A sentence for one check: a localized sentence, or the backend's own reason made readable.
public enum JarvisStatusReason: Equatable, Sendable {
    case key(JarvisInsightsLocalizationKey)
    case text(String)
}

public enum JarvisStatusLogic {
    public static let staleAfter: TimeInterval = 5 * 60

    /// Problems first, then by the backend's own order.
    public static func ordered(_ entries: [JarvisStatusEntry]) -> [JarvisStatusEntry] {
        entries.enumerated()
            .sorted { ($0.element.status.rank, $0.offset) < ($1.element.status.rank, $1.offset) }
            .map(\.element)
    }

    public static func visible(_ entries: [JarvisStatusEntry], filter: JarvisStatusFilter) -> [JarvisStatusEntry] {
        let ordered = ordered(entries)
        return filter == .issues ? ordered.filter { $0.status != .ok } : ordered
    }

    public static func isStale(checkedAt: String, now: Date) -> Bool {
        guard let date = JarvisInsightsDates.parse(checkedAt) else { return false }
        return now.timeIntervalSince(date) >= staleAfter
    }

    public static func issueCount(_ entries: [JarvisStatusEntry]) -> Int {
        entries.filter { $0.status != .ok }.count
    }

    /// The plain reason sentence for a check, or `nil` when the check needs none.
    public static func reason(for entry: JarvisStatusEntry) -> JarvisStatusReason? {
        let details = entry.details ?? [:]
        if flag(details["configured"]) == false { return .key(.statusReasonNotConfigured) }
        if let reason = text(details["reason"]),
           !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .text(readable(reason))
        }
        let id = entry.check
        if id == .foundryChat || id == .foundryVoice || id == .foundryEmbeddings {
            let catalogue = text(details["catalogue"])
            let available = flag(details["deploymentAvailable"])
            if catalogue == "fallback" { return .key(.statusReasonCatalogueFallback) }
            if catalogue == "live", available == false { return .key(.statusReasonNoDeployment) }
            if catalogue == "live", available == true { return .key(.statusReasonDeploymentListed) }
            if flag(details["configured"]) == true { return .key(.statusReasonDeploymentUnconfirmed) }
        }
        if id == .runner, flag(details["configured"]) == true,
           text(details["healthProbe"]) == "not_run" {
            return .key(.statusReasonRunnerNotProbed)
        }
        if id == .vaultIndex {
            let outcome = text(details["syncOutcome"])
            if outcome == "error" { return .key(.statusReasonVaultSyncFailed) }
            if outcome == "pending", entry.status != .ok || details["lastSuccessfulSyncAt"] == nil {
                return .key(.statusReasonVaultSyncPending)
            }
            if entry.status == .unknown, number(details["chunks"]) == 0 { return .key(.statusReasonVaultEmpty) }
            if entry.status == .degraded, flag(details["syncFresh"]) == false {
                return .key(.statusReasonVaultSyncStale)
            }
        }
        switch entry.status {
        case .unknown: return .key(.statusReasonNotEstablished)
        case .down:
            if id == .pcBridge, flag(details["connected"]) == false {
                return .key(.statusReasonBridgeDisconnected)
            }
            return .key(.statusReasonFailed)
        case .degraded: return .key(.statusReasonDegraded)
        case .ok: return nil
        }
    }

    private static func flag(_ value: JSONValue?) -> Bool? {
        guard case .bool(let flag)? = value else { return nil }
        return flag
    }

    private static func text(_ value: JSONValue?) -> String? {
        guard case .string(let text)? = value else { return nil }
        return text
    }

    private static func number(_ value: JSONValue?) -> Double? {
        guard case .number(let number)? = value else { return nil }
        return number
    }

    /// "sync_failed" becomes "Sync failed".
    public static func readable(_ key: String) -> String {
        var text = ""
        var previous: Character?
        for character in key {
            if let previous, previous.isLowercase, character.isUppercase { text.append(" ") }
            text.append(character == "_" || character == "." ? " " : character)
            previous = character
        }
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}

/// What the Status page shows. A failed refresh keeps the last snapshot visible, so the page can say it is partial.
public struct JarvisStatusViewState: Equatable, Sendable {
    public private(set) var snapshot: JarvisStatusSnapshot?
    public private(set) var failure: JarvisInsightsFailure?
    public private(set) var isLoading: Bool

    public init(snapshot: JarvisStatusSnapshot? = nil, failure: JarvisInsightsFailure? = nil, isLoading: Bool = true) {
        self.snapshot = snapshot
        self.failure = failure
        self.isLoading = isLoading
    }

    public var isPartial: Bool { snapshot != nil && failure != nil }
    public var showsFullError: Bool { snapshot == nil && failure != nil }

    public mutating func begin() {
        isLoading = true
    }

    public mutating func succeeded(_ snapshot: JarvisStatusSnapshot) {
        self.snapshot = snapshot
        failure = nil
        isLoading = false
    }

    public mutating func failed(_ error: Error) {
        failure = JarvisInsightsFailure(error)
        isLoading = false
    }
}

public final class JarvisStatusClient: Sendable {
    private let client: JarvisClient
    private static let responseLimit = 1024 * 1024
    /// The backend allows up to 30 seconds for a status read.
    public static let timeout = Duration.seconds(30)

    public init(client: JarvisClient) {
        self.client = client
    }

    public func snapshot() async throws -> JarvisStatusSnapshot {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["status"],
            idempotent: true,
            timeout: Self.timeout
        )
        guard response.statusCode == 200, response.body.count <= Self.responseLimit,
              let snapshot = try? JSONDecoder().decode(JarvisStatusSnapshot.self, from: response.body),
              snapshot.isValid else {
            throw JarvisInsightsError.invalidResponse
        }
        return snapshot
    }
}
