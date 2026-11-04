import Foundation

public enum JarvisUsagePeriod: String, CaseIterable, Identifiable, Sendable {
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case ninetyDays = "90d"
    case all

    public static let `default` = JarvisUsagePeriod.thirtyDays

    public var id: String { rawValue }

    /// Days covered by a fixed range; `nil` for "all".
    public var days: Int? {
        switch self {
        case .sevenDays: 7
        case .thirtyDays: 30
        case .ninetyDays: 90
        case .all: nil
        }
    }

    public var bucketKind: JarvisUsageBucketKind {
        switch self {
        case .sevenDays, .thirtyDays: .day
        case .ninetyDays: .week
        case .all: .month
        }
    }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .sevenDays: .usageRange7
        case .thirtyDays: .usageRange30
        case .ninetyDays: .usageRange90
        case .all: .usageRangeAll
        }
    }
}

public enum JarvisUsageBucketKind: Equatable, Sendable {
    case day
    case week
    case month
}

public enum JarvisUsageGroupBy: String, CaseIterable, Identifiable, Sendable {
    case project
    case agent
    case source

    public var id: String { rawValue }

    public var localizationKey: JarvisInsightsLocalizationKey {
        switch self {
        case .project: .usageGroupProject
        case .agent: .usageGroupAgent
        case .source: .usageGroupSource
        }
    }
}

public struct JarvisUsageEntry: Codable, Equatable, Sendable {
    public let taskId: String?
    public let taskTitle: String?
    public let projectId: String?
    public let projectName: String?
    public let agent: String
    public let source: String
    public let metric: String
    public let quantity: Double
    public let costDkk: Double?
    public let at: String
    public let estimated: Bool

    public init(
        taskId: String? = nil,
        taskTitle: String? = nil,
        projectId: String? = nil,
        projectName: String? = nil,
        agent: String,
        source: String,
        metric: String,
        quantity: Double,
        costDkk: Double?,
        at: String,
        estimated: Bool = false
    ) {
        self.taskId = taskId
        self.taskTitle = taskTitle
        self.projectId = projectId
        self.projectName = projectName
        self.agent = agent
        self.source = source
        self.metric = metric
        self.quantity = quantity
        self.costDkk = costDkk
        self.at = at
        self.estimated = estimated
    }
}

public struct JarvisUsageToolCount: Codable, Equatable, Sendable {
    public let tool: String
    public let count: String

    public init(tool: String, count: String) {
        self.tool = tool
        self.count = count
    }
}

public struct JarvisUsageDailyTools: Codable, Equatable, Sendable {
    public let date: String
    public let tools: [JarvisUsageToolCount]

    public init(date: String, tools: [JarvisUsageToolCount]) {
        self.date = date
        self.tools = tools
    }
}

public struct JarvisUsageReport: Codable, Equatable, Sendable {
    public let period: String
    public let from: String?
    public let to: String
    public let codexToolCallsToday: [JarvisUsageToolCount]?
    public let entries: [JarvisUsageEntry]
    public let totalEntries: String
    public let truncated: Bool
    public let dailyToolUsage: JarvisUsageDailyTools

    public init(
        period: String,
        from: String?,
        to: String,
        codexToolCallsToday: [JarvisUsageToolCount]? = nil,
        entries: [JarvisUsageEntry],
        totalEntries: String,
        truncated: Bool = false,
        dailyToolUsage: JarvisUsageDailyTools = JarvisUsageDailyTools(date: "1970-01-01", tools: [])
    ) {
        self.period = period
        self.from = from
        self.to = to
        self.codexToolCallsToday = codexToolCallsToday
        self.entries = entries
        self.totalEntries = totalEntries
        self.truncated = truncated
        self.dailyToolUsage = dailyToolUsage
    }

    static let agents: Set<String> = ["codex", "copilot", "jarvis"]
    static let sources: Set<String> = ["sandbox", "jarvis_model", "voice", "codex", "copilot"]
    static let metrics: Set<String> = [
        "minutes", "input_tokens", "output_tokens", "turns", "premium_requests", "screen_frames",
    ]
    public static let entryLimit = 1_000

    /// Mirrors the web app's checks: unknown agents, sources or metrics, negative numbers and bad dates are rejected.
    public var isValid: Bool {
        JarvisUsagePeriod(rawValue: period) != nil
            && JarvisInsightsDates.parse(to) != nil
            && (from.map { JarvisInsightsDates.parse($0) != nil } ?? true)
            && entries.count <= Self.entryLimit
            && entries.allSatisfy { entry in
                Self.agents.contains(entry.agent) && Self.sources.contains(entry.source)
                    && Self.metrics.contains(entry.metric)
                    && entry.quantity.isFinite && entry.quantity >= 0
                    && (entry.costDkk.map { $0.isFinite && $0 >= 0 } ?? true)
                    && JarvisInsightsDates.parse(entry.at) != nil
            }
            && totalEntries.range(of: "^[0-9]{1,19}$", options: .regularExpression) != nil
            && dailyToolUsage.date.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil
            && dailyToolUsage.tools.count <= 100
            && dailyToolUsage.tools.allSatisfy {
                !$0.tool.isEmpty && $0.tool.count <= 64 && Int($0.count) != nil
            }
            && (codexToolCallsToday?.allSatisfy { Int($0.count) != nil } ?? true)
    }
}

public struct JarvisUsageBucket: Equatable, Identifiable, Sendable {
    public let startKey: String
    public let endKey: String
    public let kind: JarvisUsageBucketKind
    public let value: Double

    public var id: String { startKey }
}

public struct JarvisUsageSlice: Equatable, Identifiable, Sendable {
    public let id: String
    /// The name stored with the data (a project name); `nil` means the screen supplies a localized name for `id`.
    public let name: String?
    public let value: Double
    /// Whole percent. Shares of one split always add up to 100.
    public let share: Int
}

public struct JarvisUsageTaskRank: Equatable, Identifiable, Sendable {
    public let id: String
    public let taskId: String?
    public let title: String?
    public let source: String
    public let value: Double
}

public struct JarvisUsageTotals: Equatable, Sendable {
    public let sandboxMinutes: Double
    public let tokens: Double
    public let turns: Double
    public let premiumRequests: Double
}

/// The numbers behind the Usage page, derived from one report. No value is invented: when no cost is reported
/// the page counts records and says so.
public struct JarvisUsageSummary: Equatable, Sendable {
    public static let topTaskLimit = 6
    public static let maximumBuckets = 60

    public let period: JarvisUsagePeriod
    public let entries: [JarvisUsageEntry]
    public let truncated: Bool
    public let totalEntries: String
    public let usesCost: Bool
    public let hasEstimates: Bool
    public let totalValue: Double
    public let buckets: [JarvisUsageBucket]
    public let toolCalls: [JarvisUsageToolCount]
    public let codexResearchCalls: Int?

    public init(report: JarvisUsageReport, period: JarvisUsagePeriod) {
        self.period = period
        entries = report.entries
        truncated = report.truncated
        totalEntries = report.totalEntries
        let usesCost = report.entries.contains { $0.costDkk != nil }
        self.usesCost = usesCost
        hasEstimates = report.entries.contains { $0.costDkk != nil && $0.estimated }
        totalValue = report.entries.reduce(0) { $0 + Self.measure($1, usesCost: usesCost) }
        buckets = Self.makeBuckets(report: report, period: period, usesCost: usesCost)
        toolCalls = report.dailyToolUsage.tools
            .filter { (Int($0.count) ?? 0) > 0 }
            .sorted { (Int($0.count) ?? 0, $1.tool) > (Int($1.count) ?? 0, $0.tool) }
        codexResearchCalls = report.codexToolCallsToday.map { $0.reduce(0) { $0 + (Int($1.count) ?? 0) } }
    }

    public var isEmpty: Bool { entries.isEmpty }

    static func measure(_ entry: JarvisUsageEntry, usesCost: Bool) -> Double {
        usesCost ? (entry.costDkk ?? 0) : 1
    }

    // MARK: Totals

    public func totals(in bucket: JarvisUsageBucket? = nil) -> JarvisUsageTotals {
        let list = entries(in: bucket)
        func sum(_ metrics: Set<String>) -> Double {
            list.filter { metrics.contains($0.metric) }.reduce(0) { $0 + $1.quantity }
        }
        return JarvisUsageTotals(
            sandboxMinutes: sum(["minutes"]),
            tokens: sum(["input_tokens", "output_tokens"]),
            turns: sum(["turns"]),
            premiumRequests: sum(["premium_requests"])
        )
    }

    public func value(in bucket: JarvisUsageBucket? = nil) -> Double {
        guard let bucket else { return totalValue }
        return bucket.value
    }

    public func entries(in bucket: JarvisUsageBucket?) -> [JarvisUsageEntry] {
        guard let bucket else { return entries }
        return entries.filter { entry in
            guard let date = JarvisInsightsDates.parse(entry.at) else { return false }
            let key = JarvisInsightsDates.dayKey(date)
            return key >= bucket.startKey && key <= bucket.endKey
        }
    }

    // MARK: Breakdown

    public func slices(by groupBy: JarvisUsageGroupBy, in bucket: JarvisUsageBucket? = nil) -> [JarvisUsageSlice] {
        var totals: [String: (name: String?, value: Double)] = [:]
        for entry in entries(in: bucket) {
            let key: String
            let name: String?
            switch groupBy {
            case .project:
                key = entry.projectId ?? "no-project"
                name = entry.projectName
            case .agent:
                key = entry.agent
                name = nil
            case .source:
                key = entry.source
                name = nil
            }
            var current = totals[key] ?? (name, 0)
            current.value += Self.measure(entry, usesCost: usesCost)
            totals[key] = current
        }
        let ordered = totals
            .filter { $0.value.value > 0 }
            .sorted { ($0.value.value, $1.key) > ($1.value.value, $0.key) }
        let shares = Self.shares(ordered.map(\.value.value))
        return ordered.enumerated().map { index, item in
            JarvisUsageSlice(id: item.key, name: item.value.name, value: item.value.value, share: shares[index])
        }
    }

    /// Whole-percent shares that add up to exactly 100 (largest remainder), in the order given.
    public static func shares(_ values: [Double]) -> [Int] {
        let total = values.reduce(0, +)
        guard total > 0, !values.isEmpty else { return values.map { _ in 0 } }
        let exact = values.map { $0 / total * 100 }
        var result = exact.map { Int($0.rounded(.down)) }
        var remaining = 100 - result.reduce(0, +)
        let order = exact.indices.sorted {
            let left = exact[$0] - Double(result[$0])
            let right = exact[$1] - Double(result[$1])
            return left == right ? $0 < $1 : left > right
        }
        var cursor = 0
        while remaining > 0, !order.isEmpty {
            result[order[cursor % order.count]] += 1
            remaining -= 1
            cursor += 1
        }
        return result
    }

    // MARK: Top tasks

    public func topTasks(in bucket: JarvisUsageBucket? = nil) -> [JarvisUsageTaskRank] {
        var ranks: [String: JarvisUsageTaskRank] = [:]
        for entry in entries(in: bucket) {
            let key = entry.taskId ?? "\(entry.source)-activity"
            let previous = ranks[key]
            ranks[key] = JarvisUsageTaskRank(
                id: key,
                taskId: entry.taskId,
                title: previous?.title ?? entry.taskTitle,
                source: entry.source,
                value: (previous?.value ?? 0) + Self.measure(entry, usesCost: usesCost)
            )
        }
        return ranks.values
            .filter { $0.value > 0 }
            .sorted { ($0.value, $1.id) > ($1.value, $0.id) }
            .prefix(Self.topTaskLimit)
            .map { $0 }
    }

    // MARK: Buckets

    private static func makeBuckets(
        report: JarvisUsageReport,
        period: JarvisUsagePeriod,
        usesCost: Bool
    ) -> [JarvisUsageBucket] {
        let calendar = JarvisInsightsDates.calendar
        let end = JarvisInsightsDates.parse(report.to) ?? Date()
        var ranges: [(String, String)] = []
        switch period.bucketKind {
        case .day:
            let count = period.days ?? 30
            for offset in stride(from: count - 1, through: 0, by: -1) {
                guard let day = calendar.date(byAdding: .day, value: -offset, to: end) else { continue }
                let key = JarvisInsightsDates.dayKey(day)
                ranges.append((key, key))
            }
        case .week:
            guard let currentWeek = calendar.dateInterval(of: .weekOfYear, for: end)?.start else { return [] }
            for offset in stride(from: 12, through: 0, by: -1) {
                guard let start = calendar.date(byAdding: .day, value: -7 * offset, to: currentWeek),
                      let last = calendar.date(byAdding: .day, value: 6, to: start) else { continue }
                ranges.append((JarvisInsightsDates.dayKey(start), JarvisInsightsDates.dayKey(last)))
            }
        case .month:
            let earliest = report.entries.compactMap { JarvisInsightsDates.parse($0.at) }.min() ?? end
            guard var cursor = calendar.dateInterval(of: .month, for: earliest)?.start,
                  let lastMonth = calendar.dateInterval(of: .month, for: end)?.start else { return [] }
            while cursor <= lastMonth, ranges.count < maximumBuckets {
                guard let interval = calendar.dateInterval(of: .month, for: cursor),
                      let last = calendar.date(byAdding: .day, value: -1, to: interval.end) else { break }
                ranges.append((JarvisInsightsDates.dayKey(interval.start), JarvisInsightsDates.dayKey(last)))
                cursor = interval.end
            }
        }
        var values = [Double](repeating: 0, count: ranges.count)
        for entry in report.entries {
            guard let date = JarvisInsightsDates.parse(entry.at) else { continue }
            let key = JarvisInsightsDates.dayKey(date)
            if let index = ranges.firstIndex(where: { key >= $0.0 && key <= $0.1 }) {
                values[index] += measure(entry, usesCost: usesCost)
            }
        }
        return ranges.enumerated().map {
            JarvisUsageBucket(startKey: $1.0, endKey: $1.1, kind: period.bucketKind, value: values[$0])
        }
    }
}

public final class JarvisUsageClient: Sendable {
    private let client: JarvisClient
    private static let responseLimit = 4 * 1024 * 1024

    public init(client: JarvisClient) {
        self.client = client
    }

    /// Conditional read for the repository layer: sends If-None-Match when a validator is known and maps 304 to
    /// `notModified`.
    public func fetchReport(
        period: JarvisUsagePeriod,
        validator: String?
    ) async throws -> JarvisFetchResult<JarvisUsageReport> {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["usage"],
            queryItems: [URLQueryItem(name: "period", value: period.rawValue)],
            headers: validator.map { ["If-None-Match": $0] } ?? [:],
            idempotent: true,
            additionalSuccessStatuses: [304]
        )
        if response.statusCode == 304 { return .notModified }
        guard response.statusCode == 200, response.body.count <= Self.responseLimit,
              let report = try? JSONDecoder().decode(JarvisUsageReport.self, from: response.body),
              report.isValid, report.period == period.rawValue else {
            throw JarvisInsightsError.invalidResponse
        }
        return .modified(report, validator: response.header("ETag"))
    }

    /// One read per call. The page reloads only on retry, refresh or a period change; nothing polls.
    public func report(period: JarvisUsagePeriod) async throws -> JarvisUsageReport {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["usage"],
            queryItems: [URLQueryItem(name: "period", value: period.rawValue)],
            idempotent: true
        )
        guard response.statusCode == 200, response.body.count <= Self.responseLimit,
              let report = try? JSONDecoder().decode(JarvisUsageReport.self, from: response.body),
              report.isValid, report.period == period.rawValue else {
            throw JarvisInsightsError.invalidResponse
        }
        return report
    }
}
