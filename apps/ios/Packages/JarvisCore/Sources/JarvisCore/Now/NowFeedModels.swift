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
