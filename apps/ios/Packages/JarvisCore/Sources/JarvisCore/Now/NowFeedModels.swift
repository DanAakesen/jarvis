import Foundation

public struct BackgroundTaskRecord: Codable, Equatable, Identifiable, Sendable {
    public enum Status: String, Codable, Sendable {
        case running, done, failed, cancelled

        public var localizationKey: JarvisFactoryLocalizationKey {
            switch self {
            case .running: .running
            case .done: .done
            case .failed: .failed
            case .cancelled: .cancelled
            }
        }
    }

    public let jobId: String
    public let kind: String?
    public let title: String
    public let status: Status
    public let detail: String?
    public let startedAt: String
    public let updatedAt: String
    public var id: String { jobId }

    public init(
        jobId: String, kind: String? = nil, title: String, status: Status, detail: String? = nil,
        startedAt: String, updatedAt: String
    ) {
        self.jobId = jobId
        self.kind = kind
        self.title = title
        self.status = status
        self.detail = detail
        self.startedAt = startedAt
        self.updatedAt = updatedAt
    }
}

/// Splits background jobs for the "Needs you" list: finished routine jobs are hidden, failures Dan can retry
/// (research) are headlines, and every other failure is a quiet, dismissible group.
public struct BackgroundTaskPresentation: Equatable, Sendable {
    public let running: [BackgroundTaskRecord]
    public let actionable: [BackgroundTaskRecord]
    public let quiet: [BackgroundTaskRecord]

    public init(tasks: [BackgroundTaskRecord]) {
        running = tasks.filter { $0.status == .running }
        let failed = tasks.filter { $0.status == .failed }
        actionable = failed.filter { $0.kind == "research" }
        quiet = failed.filter { $0.kind != "research" }
    }

    public var isEmpty: Bool { running.isEmpty && actionable.isEmpty && quiet.isEmpty }

    public var needsYouCount: Int { actionable.count }
}

public enum NowFeedActivityCategory: String, Codable, Equatable, CaseIterable, Sendable {
    case attention
    case release
    case credential
    case alert
}

public struct NowFeedActivityItem: Codable, Equatable, Sendable {
    public let id: String
    public let category: NowFeedActivityCategory
    public let title: String
    public let link: String?
    public let at: String
}

/// Proactive notifications of one category collapsed into one row: the latest update, how many older ones sit
/// behind it, and every item so the group can be dismissed or cleared.
public struct NowFeedActivityGroup: Equatable, Identifiable, Sendable {
    public let category: NowFeedActivityCategory
    /// Newest first.
    public let items: [NowFeedActivityItem]
    public var id: String { category.rawValue }
    public var latest: NowFeedActivityItem { items[0] }
    public var olderCount: Int { items.count - 1 }
}

public enum NowFeedActivityGrouping {
    /// One group per category that has items, in category order. Items inside a group are newest first;
    /// items whose time cannot be read keep their feed order after the dated ones.
    public static func groups(_ items: [NowFeedActivityItem]) -> [NowFeedActivityGroup] {
        NowFeedActivityCategory.allCases.compactMap { category in
            let inCategory = items.enumerated().filter { $0.element.category == category }
            guard !inCategory.isEmpty else { return nil }
            let sorted = inCategory.sorted { lhs, rhs in
                switch (date(lhs.element.at), date(rhs.element.at)) {
                case let (l?, r?): l != r ? l > r : lhs.offset < rhs.offset
                case (_?, nil): true
                case (nil, _?): false
                case (nil, nil): lhs.offset < rhs.offset
                }
            }
            return NowFeedActivityGroup(category: category, items: sorted.map(\.element))
        }
    }

    private static func date(_ value: String) -> Date? {
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: value) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions.insert(.withFractionalSeconds)
        return fractional.date(from: value)
    }
}

public struct NowFeedRunningTask: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let project: String
    public let agent: String
    public let activity: String
    public let startedAt: String
}

public struct JarvisNowFeed: Codable, Equatable, Sendable {
    public let running: [NowFeedRunningTask]
    public let items: [NowFeedActivityItem]
    public let updatedAt: String
    public let awayMode: Bool
    public let confirmations: [PendingConfirmation]
}

public enum JarvisNowFeedClientError: Error, Equatable, Sendable {
    case invalidActivityID
    case activityUnavailable
    case invalidResponse
}
