import Foundation

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
