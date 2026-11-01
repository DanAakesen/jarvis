import Foundation

public enum ConfirmationDecision: String, Codable, Sendable {
    case approve
    case reject
}

public enum ConfirmationActionKind: String, Codable, Sendable {
    case merge, delete
    case sendMail = "send_mail"
    case calendarChange = "calendar_change"
    case createRepository = "create_repository"
    case computerUse = "computer_use"
    case spendMoney = "spend_money"
    case other
}

public struct PendingConfirmation: Codable, Equatable, Sendable {
    public let id: String
    public let actionKind: ConfirmationActionKind
    public let summary: String
    public let expiresAt: String
}

public struct PendingConfirmations: Codable, Equatable, Sendable {
    public let confirmations: [PendingConfirmation]
    public let awayMode: Bool
    public let updatedAt: String
}

public enum JarvisApprovalsClientError: Error, Equatable, Sendable {
    case invalidConfirmationID
    case invalidResponse
    case confirmationUnavailable
    case awayMode
}

/// The confirmation subset of the existing Now routes, not a general Now-feed client.
public final class JarvisApprovalsClient: Sendable {
    private let client: JarvisClient

    public init(client: JarvisClient) { self.client = client }

    public func pendingConfirmations() async throws -> PendingConfirmations {
        let response = try await client.performAuthenticatedRequest(
            method: .get, path: ["now"], idempotent: true
        )
        guard response.statusCode == 200, response.body.count <= 1024 * 1024,
              let result = try? JSONDecoder().decode(PendingConfirmations.self, from: response.body),
              result.confirmations.count <= 11,
              result.confirmations.filter({ $0.actionKind == .calendarChange }).count <= 1,
              result.confirmations.filter({ $0.actionKind != .calendarChange }).count <= 10,
              Self.validTime(result.updatedAt),
              result.confirmations.allSatisfy({
                  Self.validID($0.id) && !$0.summary.isEmpty &&
                  $0.summary.utf16.count <= ($0.actionKind == .calendarChange ? 40_000 : 4_000) &&
                  Self.validTime($0.expiresAt)
              }) else {
            throw JarvisApprovalsClientError.invalidResponse
        }
        return result
    }

    public func resolveConfirmation(id: String, decision: ConfirmationDecision) async throws {
        guard Self.validID(id) else { throw JarvisApprovalsClientError.invalidConfirmationID }
        do {
            let response = try await client.performAuthenticatedRequest(
                method: .post,
                path: ["now", "confirmations", id],
                body: try JSONEncoder().encode(DecisionRequest(decision: decision)),
                idempotent: false
            )
            guard response.statusCode == 204 else { throw JarvisApprovalsClientError.invalidResponse }
        } catch JarvisClientError.httpStatus(404) {
            throw JarvisApprovalsClientError.confirmationUnavailable
        } catch JarvisClientError.httpStatus(409) {
            throw JarvisApprovalsClientError.awayMode
        }
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
    }

    private static func validTime(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value) != nil
    }
}

private struct DecisionRequest: Encodable {
    let decision: ConfirmationDecision
}
