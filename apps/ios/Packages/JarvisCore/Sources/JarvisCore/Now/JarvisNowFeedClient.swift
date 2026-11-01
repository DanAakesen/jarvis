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

    public func resolveConfirmation(id: String, decision: ConfirmationDecision) async throws {
        try await approvals.resolveConfirmation(id: id, decision: decision)
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
