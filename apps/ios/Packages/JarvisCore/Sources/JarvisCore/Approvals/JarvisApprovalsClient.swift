import Foundation

public final class JarvisApprovalsClient: Sendable {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func pendingConfirmations() async throws -> [PendingConfirmation] {
        let response = try await client.performChatRequest(
            method: .get,
            path: ["now"],
            idempotent: true
        )
        guard response.statusCode == 200,
              let feed = try? JSONDecoder().decode(PendingConfirmationsResponse.self, from: response.body),
              feed.confirmations.allSatisfy(Self.isValid) else {
            throw JarvisApprovalsClientError.invalidResponse
        }
        return feed.confirmations
    }

    public func decide(id: String, decision: ConfirmationDecision) async throws {
        guard Self.validConfirmationID(id) else {
            throw JarvisApprovalsClientError.invalidConfirmationID
        }
        let body: Data
        do {
            body = try JSONEncoder().encode(ConfirmationDecisionRequest(decision: decision))
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }

        do {
            let response = try await client.performChatRequest(
                method: .post,
                path: ["now", "confirmations", id],
                body: body,
                idempotent: false
            )
            guard response.statusCode == 204 else {
                throw JarvisApprovalsClientError.invalidResponse
            }
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error {
                throw JarvisApprovalsClientError.noLongerAvailable
            }
            throw error
        }
    }

    private static func isValid(_ confirmation: PendingConfirmation) -> Bool {
        let formatter = ISO8601DateFormatter()
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let hasValidExpiry = formatter.date(from: confirmation.expiresAt) != nil ||
            fractionalFormatter.date(from: confirmation.expiresAt) != nil
        return validConfirmationID(confirmation.id) &&
            !confirmation.summary.isEmpty &&
            confirmation.summary.utf16.count <= 4_000 &&
            hasValidExpiry
    }

    private static func validConfirmationID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
    }
}

private struct PendingConfirmationsResponse: Decodable {
    let confirmations: [PendingConfirmation]
}

private struct ConfirmationDecisionRequest: Encodable {
    let decision: ConfirmationDecision
}
