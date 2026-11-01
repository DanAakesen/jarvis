import Foundation

public final class JarvisNowFeedClient: Sendable {
    private let client: JarvisClient
    private let approvals: JarvisApprovalsClient

    public init(client: JarvisClient) {
        self.client = client
        approvals = JarvisApprovalsClient(client: client)
    }

    public func load() async throws -> JarvisNowFeed {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["now"],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= 1024 * 1024,
              let feed = try? JSONDecoder().decode(JarvisNowFeed.self, from: response.body),
              Self.valid(feed) else {
            throw JarvisNowFeedClientError.invalidResponse
        }
        return feed
    }

    public func dismissActivity(id: String) async throws {
        guard Self.validActivityID(id) else {
            throw JarvisNowFeedClientError.invalidActivityID
        }
        do {
            let response = try await client.performAuthenticatedRequest(
                method: .post,
                path: ["now", "activity", id, "dismiss"],
                idempotent: false
            )
            guard response.statusCode == 204 else {
                throw JarvisNowFeedClientError.invalidResponse
            }
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error {
                throw JarvisNowFeedClientError.activityUnavailable
            }
            throw error
        }
    }

    public func backgroundTasks() async throws -> [BackgroundTaskRecord] {
        let response = try await client.performAuthenticatedRequest(
            method: .get, path: ["jobs"], idempotent: true
        )
        guard response.statusCode == 200, response.body.count <= 1024 * 1024,
              let snapshot = try? JSONDecoder().decode(BackgroundTaskSnapshot.self, from: response.body),
              snapshot.jobs.count <= 1_000,
              snapshot.jobs.allSatisfy({
                  UUID(uuidString: $0.jobId) != nil &&
                      !$0.title.isEmpty && $0.title.utf16.count <= 80 &&
                      ($0.detail?.utf16.count ?? 0) <= 120 &&
                      Self.validTime($0.startedAt) && Self.validTime($0.updatedAt)
              }) else {
            throw JarvisNowFeedClientError.invalidResponse
        }
        return snapshot.jobs
    }

    public func registerTaskActivity(
        taskID: String, activityID: String, pushToken: String, language: JarvisAppLanguage
    ) async throws {
        guard UUID(uuidString: taskID) != nil || Self.validID(taskID),
              activityID.range(of: #"^[A-Za-z0-9-]{1,128}$"#, options: .regularExpression) != nil,
              pushToken.range(of: #"^(?:[0-9a-f]{2}){32,256}$"#, options: .regularExpression) != nil else {
            throw JarvisNowFeedClientError.invalidResponse
        }
        _ = try await client.performAuthenticatedRequest(
            method: .post, path: ["ios", "task-activities"],
            body: JSONEncoder().encode(TaskActivityRegistration(
                taskID: taskID, activityID: activityID, pushToken: pushToken, language: language.rawValue
            )),
            idempotent: true
        )
    }

    public func resolveConfirmation(id: String, decision: ConfirmationDecision) async throws {
        try await approvals.resolveConfirmation(id: id, decision: decision)
    }

    private struct BackgroundTaskSnapshot: Decodable {
        let jobs: [BackgroundTaskRecord]
    }

    private struct TaskActivityRegistration: Encodable {
        let taskID: String
        let activityID: String
        let pushToken: String
        let language: String
    }

    private static func valid(_ feed: JarvisNowFeed) -> Bool {
        feed.running.count <= 100 &&
            feed.items.count <= 100 &&
            feed.confirmations.count <= 11 &&
            feed.confirmations.filter({ $0.actionKind == .calendarChange }).count <= 1 &&
            feed.confirmations.filter({ $0.actionKind != .calendarChange }).count <= 10 &&
            validTime(feed.updatedAt) &&
            feed.running.allSatisfy {
                validID($0.id) && !$0.title.isEmpty && $0.title.utf16.count <= 200 &&
                    !$0.project.isEmpty && $0.project.utf16.count <= 100 &&
                    ["codex", "copilot"].contains($0.agent) &&
                    $0.activity.utf16.count <= 400 && validTime($0.startedAt)
            } &&
            feed.items.allSatisfy {
                validID($0.id) && !$0.title.isEmpty && $0.title.utf16.count <= 400 &&
                    ($0.link?.utf16.count ?? 0) <= 2_048 && validTime($0.at)
            } &&
            feed.confirmations.allSatisfy {
                !$0.summary.isEmpty &&
                    $0.summary.utf16.count <= ($0.actionKind == .calendarChange ? 40_000 : 4_000)
            }
    }

    private static func validActivityID(_ value: String) -> Bool {
        validID(value) && Int64(value).map { $0 > 0 } == true
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil
    }

    private static func validTime(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value) != nil
    }
}
