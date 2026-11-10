import Foundation

/// Only safe, bounded server failure details cross to the Watch; raw network/provider errors never do.
public struct WatchTaskMutationFailure: Error, Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let retryable: Bool
    public let outcomeUnknown: Bool
    private enum CodingKeys: String, CodingKey { case code, message, retryable, outcomeUnknown }

    public init(code: String, message: String, retryable: Bool, outcomeUnknown: Bool) {
        self.code = code
        self.message = WatchLimits.displayText(message, maximumBytes: 1_000, notice: "…")
        self.retryable = retryable; self.outcomeUnknown = outcomeUnknown
    }
    public var isValid: Bool {
        code.range(of: #"^[A-Za-z0-9_]{1,80}$"#, options: .regularExpression) != nil &&
            !message.isEmpty && message.utf8.count <= 1_003 &&
            !message.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) && $0 != "\n" }
    }
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decode(String.self, forKey: .code)
        message = try container.decode(String.self, forKey: .message)
        retryable = try container.decode(Bool.self, forKey: .retryable)
        outcomeUnknown = try container.decode(Bool.self, forKey: .outcomeUnknown)
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                                                    debugDescription: "Invalid task failure detail"))
        }
    }
    public static let unknown = WatchTaskMutationFailure(
        code: "outcome_unknown",
        message: "The save could not be confirmed. Refresh tasks before retrying. Your original submission is kept.",
        retryable: true, outcomeUnknown: true
    )
}

public enum JarvisWatchTasksClientError: Error, Equatable, Sendable {
    case invalidRequest
    case failure(WatchTaskMutationFailure)
}

public final class JarvisWatchTasksClient: Sendable {
    private let client: JarvisClient
    public init(client: JarvisClient) { self.client = client }

    public func create(_ value: WatchTaskCreateRequest) async throws -> VaultTask {
        guard value.isValid else { throw JarvisWatchTasksClientError.invalidRequest }
        return try await mutate(method: .post, body: JSONEncoder().encode(value))
    }

    public func update(_ value: WatchTaskUpdateRequest) async throws -> VaultTask {
        guard value.isValid else { throw JarvisWatchTasksClientError.invalidRequest }
        let task = try await mutate(method: .patch, body: JSONEncoder().encode(value))
        guard task.path == value.path, task.line == value.line else {
            throw JarvisWatchTasksClientError.failure(.unknown)
        }
        return task
    }

    private func mutate(method: HTTPMethod, body: Data) async throws -> VaultTask {
        guard body.count <= WatchTaskValidation.requestBytes else { throw JarvisWatchTasksClientError.invalidRequest }
        do {
            let response = try await client.performAuthenticatedRequest(
                method: method, path: ["vault", "watch-tasks"], body: body,
                idempotent: false, additionalSuccessStatuses: [400, 409, 413, 422, 503],
                timeout: .seconds(20)
            )
            guard response.body.count <= WatchTaskValidation.responseBytes else {
                throw JarvisWatchTasksClientError.failure(.unknown)
            }
            if !(200..<300).contains(response.statusCode) {
                struct FailureBody: Decodable {
                    let error: String
                    let code: String?
                    let outcomeUnknown: Bool?
                    let retryable: Bool?
                }
                let error = try? JSONDecoder().decode(FailureBody.self, from: response.body)
                let uncertain = error?.outcomeUnknown ?? (response.statusCode >= 500)
                throw JarvisWatchTasksClientError.failure(.init(
                    code: error?.code ?? "http_\(response.statusCode)",
                    message: error?.error ?? (uncertain ? WatchTaskMutationFailure.unknown.message :
                        "The task was rejected. Check the title, notes, date and time."),
                    retryable: error?.retryable ?? (response.statusCode >= 500),
                    outcomeUnknown: uncertain
                ))
            }
            guard let task = try? JSONDecoder().decode(VaultTask.self, from: response.body),
                  WatchTaskValidation.task(task) else {
                throw JarvisWatchTasksClientError.failure(.unknown)
            }
            return task
        } catch let error as JarvisWatchTasksClientError { throw error }
        catch let error as JarvisClientError {
            switch error {
            case .signInRequired, .notOwner: throw error
            case .rateLimited:
                throw JarvisWatchTasksClientError.failure(.init(
                    code: "rate_limited", message: "Too many task requests. Wait a moment, then retry.",
                    retryable: true, outcomeUnknown: false
                ))
            default: throw JarvisWatchTasksClientError.failure(.unknown)
            }
        } catch { throw JarvisWatchTasksClientError.failure(.unknown) }
    }
}
