import Foundation

public enum FactoryAgent: String, Codable, CaseIterable, Sendable {
    case codex
    case copilot
}

public enum FactoryTaskState: String, Codable, CaseIterable, Sendable {
    case ready = "Ready"
    case running = "Running"
    case pauseRequested = "PauseRequested"
    case paused = "Paused"
    case needsAttention = "NeedsAttention"
    case done = "Done"
    case cancelled = "Cancelled"

    public func activityPhase(latestSessionEndReason: FactorySessionEndReason?) -> String {
        switch self {
        case .running, .pauseRequested: "running"
        case .ready, .paused: "waiting"
        case .needsAttention: latestSessionEndReason == .crashed ? "failed" : "waiting"
        case .done: "done"
        case .cancelled: "cancelled"
        }
    }
}

public enum FactoryProjectPolicy: String, Codable, CaseIterable, Sendable {
    case deliverPullRequest = "deliver_pr"
    case completeWithoutDeployment = "complete_without_deployment"
}

public struct FactoryProject: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let repo: String
    public let defaultBranch: String
    public let defaultAgent: FactoryAgent
    public let policy: FactoryProjectPolicy

    enum CodingKeys: String, CodingKey {
        case id, name, repo, policy
        case defaultBranch = "default_branch"
        case defaultAgent = "default_agent"
    }
}

public enum FactoryBoardColumnID: String, Codable, CaseIterable, Identifiable, Sendable {
    case backlog
    case needsDan = "needs_dan"
    case ready
    case inProgress = "in_progress"
    case inReview = "in_review"
    case done

    public var id: String { rawValue }
}

public struct FactoryBoardIssue: Codable, Equatable, Identifiable, Sendable {
    public let number: Int
    public let url: String
    public let title: String
    public let taskCode: String?
    public let labels: [String]
    public let worker: String?
    public let state: String
    public let updatedAt: String
    public let closedAt: String?
    public let blockedBy: [Int]

    public var id: Int { number }
}

public struct FactoryBoardPullRequest: Codable, Equatable, Sendable {
    public let number: Int
    public let url: String
    public let draft: Bool
    public let checks: String
}

public struct FactoryBoardTask: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let state: FactoryTaskState
    public let agent: FactoryAgent
    public let activity: String?
    public let attemptCount: Int
    public let branch: String?
    public let startedAt: String?
    public let latestSessionEndReason: String?
}

public struct FactoryBoardCard: Codable, Equatable, Identifiable, Sendable {
    public let issue: FactoryBoardIssue
    public let pr: FactoryBoardPullRequest?
    public let task: FactoryBoardTask?

    public var id: Int { issue.number }
}

public struct FactoryBoardColumn: Codable, Equatable, Identifiable, Sendable {
    public let id: FactoryBoardColumnID
    public let cards: [FactoryBoardCard]
}

public struct FactoryBoard: Codable, Equatable, Sendable {
    public struct Project: Codable, Equatable, Sendable {
        public let id: String
        public let repo: String
    }

    public let project: Project
    public let fetchedAt: String
    public let stale: Bool
    public let columns: [FactoryBoardColumn]
}

public enum FactoryTaskSource: String, Codable, Sendable {
    case board
    case voice
    case chat
}

public enum FactorySessionEndReason: String, Codable, Sendable {
    case done
    case cancelled
    case crashed
    case idle
    case idleExpired = "idle_expired"
}

public struct FactoryTaskPullRequest: Codable, Equatable, Sendable {
    public let number: Int
    public let url: String
    public let state: String?
}

public struct FactoryTaskUsageSummary: Codable, Equatable, Sendable {
    public let inputTokens: Int?
    public let outputTokens: Int?
    public let costDkk: Double?
}

public struct FactoryTaskRecord: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let issueNumber: Int?
    public let originMessageId: String?
    public let title: String
    public let request: String
    public let source: FactoryTaskSource
    public let agent: FactoryAgent
    public let modelOverride: String?
    public let reasoningOverride: String?
    public let state: FactoryTaskState
    public let activity: String?
    public let priority: Int
    public let attemptCount: Int
    public let nextAttemptAt: String?
    public let branch: String?
    public let pullRequest: FactoryTaskPullRequest?
    public let checks: String?
    public let checkConclusion: String?
    public let usageSummary: FactoryTaskUsageSummary?
    public let latestSessionEndReason: FactorySessionEndReason?
    public let createdAt: String
    public let startedAt: String?
    public let finishedAt: String?
}

public indirect enum FactoryJSONValue: Codable, Equatable, Sendable {
    case object([String: FactoryJSONValue])
    case array([FactoryJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([FactoryJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: FactoryJSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

public enum FactoryTaskEventSource: String, Codable, Sendable {
    case runner
    case backend
    case github
    case dan
}

public struct FactoryTaskEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let taskId: String
    public let type: String
    public let summary: String?
    public let payload: FactoryJSONValue
    public let payloadTruncated: Bool
    public let source: FactoryTaskEventSource
    public let at: String
}

public enum FactoryUsageSource: String, Codable, Sendable {
    case sandbox
    case jarvisModel = "jarvis_model"
    case voice
    case codex
    case copilot
}

public enum FactoryUsageMetric: String, Codable, Sendable {
    case minutes
    case inputTokens = "input_tokens"
    case outputTokens = "output_tokens"
    case turns
    case premiumRequests = "premium_requests"
}

public struct FactoryTaskUsage: Codable, Equatable, Identifiable, Sendable {
    public let id: String?
    public let source: FactoryUsageSource
    public let metric: FactoryUsageMetric
    public let quantity: Double
    public let costDkk: Double?
    public let sandboxSessionId: String?
    public let at: String
    public let estimated: Bool

    public var identity: String { id ?? "\(source.rawValue):\(metric.rawValue):\(at)" }
    public var stableID: String { identity }
}

public struct FactoryTaskDetail: Decodable, Equatable, Sendable {
    public let task: FactoryTaskRecord
    public let events: [FactoryTaskEvent]
    public let usage: [FactoryTaskUsage]

    private enum CodingKeys: String, CodingKey {
        case events, usage
    }

    public init(from decoder: Decoder) throws {
        task = try FactoryTaskRecord(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        events = try container.decode([FactoryTaskEvent].self, forKey: .events)
        usage = try container.decode([FactoryTaskUsage].self, forKey: .usage)
    }
}

public enum FactoryReleaseStatus: String, Codable, Sendable {
    case building
    case deploying
    case released
    case failed
}

public struct FactoryRelease: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let version: String
    public let sha: String
    public let status: FactoryReleaseStatus
    public let createdAt: String
    public let releasedAt: String?
}

public struct FactoryReleasePullRequest: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let number: Int
    public let branch: String
    public let headSha: String
    public let state: String
    public let checks: String
    public let taskId: String?
}

public struct FactoryWorkflowRun: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let workflow: String
    public let trigger: String
    public let headSha: String
    public let status: String
    public let conclusion: String?
    public let startedAt: String?
    public let completedAt: String?
    public let releaseId: String?
    public let pullRequestNumber: Int?
    public let taskId: String?
}

public struct FactoryDeployment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let releaseId: String
    public let environment: String
    public let status: String
    public let at: String
}

public struct FactoryCommit: Codable, Equatable, Identifiable, Sendable {
    public let sha: String
    public let message: String
    public let author: String
    public let committedAt: String
    public let parents: [String]

    public var id: String { sha }
}

public struct FactoryCommitList: Codable, Equatable, Sendable {
    public let fetchedAt: String
    public let truncated: Bool
    public let commits: [FactoryCommit]
}

public struct FactoryReleaseView: Codable, Equatable, Sendable {
    public struct Project: Codable, Equatable, Sendable {
        public let id: String
        public let name: String
        public let repo: String
        public let defaultBranch: String
    }

    public let project: Project
    public let releases: [FactoryRelease]
    public let pullRequests: [FactoryReleasePullRequest]
    public let workflowRuns: [FactoryWorkflowRun]
    public let deployments: [FactoryDeployment]
    public let graph: FactoryCommitList?
}

public struct FactoryTaskList: Decodable, Equatable, Sendable {
    public let tasks: [FactoryTaskRecord]
    public let limit: Int
    public let offset: Int
}
