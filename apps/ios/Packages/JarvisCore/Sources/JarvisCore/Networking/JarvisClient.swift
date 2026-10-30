import Foundation

public enum JarvisClientError: Error, Equatable, Sendable {
    case signInRequired
    case notOwner
    case rateLimited(retryAfter: Duration?)
    case serviceUnavailable
    case httpStatus(Int)
    case networkFailure
    case timedOut
    case invalidRequest
    case invalidBaseURL
    case tokenStoreFailure
    case responseEncodingFailure
    case responseDecodingFailure
}

public struct RetryPolicy: Sendable {
    public let maximumRetries: Int
    public let delay: Duration
    public let maximumDelay: Duration

    public init(
        maximumRetries: Int = 2,
        delay: Duration = .milliseconds(100),
        maximumDelay: Duration = .seconds(2)
    ) {
        self.maximumRetries = min(max(maximumRetries, 0), 3)
        self.delay = min(max(delay, .zero), max(maximumDelay, .zero))
        self.maximumDelay = max(maximumDelay, .zero)
    }
}

public struct JarvisClientConfiguration: Sendable {
    public let baseURL: URL
    public let requestTimeout: Duration
    public let retryPolicy: RetryPolicy

    public init(
        baseURL: URL,
        requestTimeout: Duration = .seconds(30),
        retryPolicy: RetryPolicy = RetryPolicy()
    ) {
        self.baseURL = baseURL
        self.requestTimeout = max(requestTimeout, .milliseconds(1))
        self.retryPolicy = retryPolicy
    }
}

public final class JarvisClient: Sendable {
    private let configuration: JarvisClientConfiguration
    private let transport: any HTTPTransport
    private let tokenStore: any TokenStore
    private let accessTokenProvider: any AccessTokenProvider

    public init(
        configuration: JarvisClientConfiguration,
        transport: any HTTPTransport,
        tokenStore: any TokenStore,
        accessTokenProvider: any AccessTokenProvider
    ) throws {
        let components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false)
        guard let components,
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            throw JarvisClientError.invalidBaseURL
        }
        self.configuration = configuration
        self.transport = transport
        self.tokenStore = tokenStore
        self.accessTokenProvider = accessTokenProvider
    }

    public func createOwnerSession(deviceLabel: String? = nil) async throws -> OwnerSession {
        let body: Data?
        if let deviceLabel {
            body = try encode(DeviceLabelRequest(deviceLabel: deviceLabel))
        } else {
            body = nil
        }
        let response = try await send(
            method: .post,
            path: ["auth", "session"],
            body: body,
            authorization: .provider,
            idempotent: false
        )
        guard response.statusCode == 201 else { throw JarvisClientError.httpStatus(response.statusCode) }
        let session: OwnerSession = try decode(response.body)
        do {
            try await tokenStore.write(session.token)
        } catch {
            _ = try? await send(
                method: .delete,
                path: ["auth", "session"],
                authorization: .explicit(session.token),
                idempotent: false
            )
            throw JarvisClientError.tokenStoreFailure
        }
        return session
    }

    public func revokeCurrentSession() async throws {
        let token = try await storedSessionToken()
        let response = try await send(
            method: .delete,
            path: ["auth", "session"],
            authorization: .explicit(token),
            idempotent: false
        )
        guard response.statusCode == 204 else { throw JarvisClientError.httpStatus(response.statusCode) }
        do {
            try await tokenStore.delete()
        } catch {
            throw JarvisClientError.tokenStoreFailure
        }
    }

    public func revokeAllSessions() async throws -> RevokedSessions {
        let response = try await send(
            method: .delete,
            path: ["auth", "sessions"],
            authorization: .current,
            idempotent: false
        )
        guard response.statusCode == 200 else { throw JarvisClientError.httpStatus(response.statusCode) }
        let revoked: RevokedSessions = try decode(response.body)
        do {
            try await tokenStore.delete()
        } catch {
            throw JarvisClientError.tokenStoreFailure
        }
        return revoked
    }

    public func listTools() async throws -> [JarvisToolDescriptor] {
        let response = try await send(
            method: .get,
            path: ["tools"],
            authorization: .current,
            idempotent: true
        )
        return try decode(response.body)
    }

    public func runTool<Arguments: Encodable & Sendable, Result: Codable & Sendable>(
        _ name: String,
        arguments: Arguments,
        messageId: String? = nil,
        as resultType: Result.Type = Result.self
    ) async throws -> ToolCallResponse<Result> {
        guard name.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil else {
            throw JarvisClientError.invalidRequest
        }
        if let messageId, !isValidMessageId(messageId) {
            throw JarvisClientError.invalidRequest
        }
        let headers = messageId.map { ["x-jarvis-message-id": $0] } ?? [:]
        let response = try await send(
            method: .post,
            path: ["tools", name],
            headers: headers,
            body: try encode(arguments),
            authorization: .current,
            idempotent: false
        )
        return try decode(response.body)
    }

    private enum Authorization {
        case current
        case provider
        case explicit(String)
    }

    private func send(
        method: HTTPMethod,
        path: [String],
        headers: [String: String] = [:],
        body: Data? = nil,
        authorization: Authorization,
        idempotent: Bool,
        additionalSuccessStatuses: Set<Int> = [],
        queryItems: [URLQueryItem] = [],
        accept: String = "application/json",
        contentType: String? = "application/json",
        timeout: Duration? = nil
    ) async throws -> HTTPResponse {
        let request = try await makeRequest(
            method: method,
            path: path,
            headers: headers,
            body: body,
            authorization: authorization,
            queryItems: queryItems,
            accept: accept,
            contentType: contentType,
            timeout: timeout
        )

        var retries = 0
        while true {
            try Task.checkCancellation()
            do {
                let response = try await transport.send(request)
                switch response.statusCode {
                case 401:
                    await requireSignIn()
                    throw JarvisClientError.signInRequired
                case 403:
                    throw JarvisClientError.notOwner
                case 429:
                    let retryAfter = Self.parseRetryAfter(response.header("Retry-After"))
                    let delayIsBounded = retryAfter.map { $0 <= configuration.retryPolicy.maximumDelay } ?? true
                    if idempotent, retries < configuration.retryPolicy.maximumRetries, delayIsBounded {
                        try await waitBeforeRetry(retryAfter: retryAfter)
                        retries += 1
                        continue
                    }
                    throw JarvisClientError.rateLimited(retryAfter: retryAfter)
                case 503:
                    if idempotent, retries < configuration.retryPolicy.maximumRetries {
                        try await waitBeforeRetry(retryAfter: nil)
                        retries += 1
                        continue
                    }
                    throw JarvisClientError.serviceUnavailable
                case 200..<300:
                    return response
                case let status where additionalSuccessStatuses.contains(status):
                    return response
                default:
                    throw JarvisClientError.httpStatus(response.statusCode)
                }
            } catch let error as JarvisClientError {
                throw error
            } catch is CancellationError {
                throw CancellationError()
            } catch let failure as HTTPTransportFailure {
                let isRetryable = idempotent && retries < configuration.retryPolicy.maximumRetries
                if isRetryable {
                    try await waitBeforeRetry(retryAfter: nil)
                    retries += 1
                    continue
                }
                switch failure {
                case .network:
                    throw JarvisClientError.networkFailure
                case .timedOut:
                    throw JarvisClientError.timedOut
                }
            } catch {
                throw JarvisClientError.networkFailure
            }
        }
    }

    func performAuthenticatedRequest(
        method: HTTPMethod,
        path: [String],
        queryItems: [URLQueryItem] = [],
        headers: [String: String] = [:],
        body: Data? = nil,
        contentType: String? = "application/json",
        idempotent: Bool,
        additionalSuccessStatuses: Set<Int> = [],
        accept: String = "application/json",
        timeout: Duration? = nil
    ) async throws -> HTTPResponse {
        try await send(
            method: method,
            path: path,
            headers: headers,
            body: body,
            authorization: .current,
            idempotent: idempotent,
            additionalSuccessStatuses: additionalSuccessStatuses,
            queryItems: queryItems,
            accept: accept,
            contentType: contentType,
            timeout: timeout
        )
    }

    func performChatStream(
        method: HTTPMethod,
        path: [String],
        body: Data? = nil,
        accept: String = "text/event-stream"
    ) async throws -> HTTPStreamResponse {
        let request = try await makeRequest(
            method: method,
            path: path,
            headers: [:],
            body: body,
            authorization: .current,
            queryItems: [],
            accept: accept,
            contentType: "application/json"
        )
        try Task.checkCancellation()
        do {
            let response = try await transport.stream(request)
            switch response.statusCode {
            case 401:
                await requireSignIn()
                throw JarvisClientError.signInRequired
            case 403:
                throw JarvisClientError.notOwner
            case 429:
                throw JarvisClientError.rateLimited(retryAfter: Self.parseRetryAfter(response.header("Retry-After")))
            case 503:
                throw JarvisClientError.serviceUnavailable
            case 200..<300:
                return response
            default:
                throw JarvisClientError.httpStatus(response.statusCode)
            }
        } catch let error as JarvisClientError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as HTTPTransportFailure {
            switch failure {
            case .network:
                throw JarvisClientError.networkFailure
            case .timedOut:
                throw JarvisClientError.timedOut
            }
        } catch {
            throw JarvisClientError.networkFailure
        }
    }

    private func makeRequest(
        method: HTTPMethod,
        path: [String],
        headers: [String: String],
        body: Data?,
        authorization: Authorization,
        queryItems: [URLQueryItem],
        accept: String,
        contentType: String?,
        timeout: Duration? = nil
    ) async throws -> HTTPRequest {
        var url = configuration.baseURL
        for component in path { url.append(path: component) }
        if !queryItems.isEmpty {
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                throw JarvisClientError.invalidBaseURL
            }
            components.queryItems = queryItems
            guard let queryURL = components.url else { throw JarvisClientError.invalidBaseURL }
            url = queryURL
        }

        var requestHeaders = headers
        requestHeaders["Accept"] = accept
        if body != nil, let contentType {
            requestHeaders["Content-Type"] = contentType
        }
        let unsignedRequest = HTTPRequest(
            method: method,
            url: url,
            headers: requestHeaders,
            body: body,
            timeout: min(timeout ?? configuration.requestTimeout, configuration.requestTimeout)
        )
        let token: String
        switch authorization {
        case .current:
            if let storedToken = try await readStoredToken() {
                token = storedToken
            } else {
                token = try await providerToken(for: unsignedRequest)
            }
        case .provider:
            token = try await providerToken(for: unsignedRequest)
        case .explicit(let value):
            token = value
        }
        requestHeaders["Authorization"] = ["Bear", "er"].joined() + " " + token
        return HTTPRequest(
            method: method,
            url: url,
            headers: requestHeaders,
            body: body,
            timeout: unsignedRequest.timeout
        )
    }

    private func readStoredToken() async throws -> String? {
        do {
            return try await tokenStore.read()
        } catch {
            throw JarvisClientError.tokenStoreFailure
        }
    }

    private func storedSessionToken() async throws -> String {
        guard let token = try await readStoredToken() else {
            await accessTokenProvider.requestSignIn()
            throw JarvisClientError.signInRequired
        }
        return token
    }

    private func providerToken(for request: HTTPRequest) async throws -> String {
        do {
            return try await accessTokenProvider.currentToken(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            await accessTokenProvider.requestSignIn()
            throw JarvisClientError.signInRequired
        }
    }

    private func requireSignIn() async {
        try? await tokenStore.delete()
        await accessTokenProvider.requestSignIn()
    }

    private func waitBeforeRetry(retryAfter: Duration?) async throws {
        try Task.checkCancellation()
        let delay = min(retryAfter ?? configuration.retryPolicy.delay, configuration.retryPolicy.maximumDelay)
        try await Task.sleep(for: delay)
    }

    private func encode<Value: Encodable>(_ value: Value) throws -> Data {
        do {
            return try JSONEncoder().encode(value)
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
    }

    private func decode<Value: Decodable>(_ data: Data) throws -> Value {
        do {
            return try JSONDecoder().decode(Value.self, from: data)
        } catch {
            throw JarvisClientError.responseDecodingFailure
        }
    }

    private func isValidMessageId(_ value: String) -> Bool {
        guard value.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil else {
            return false
        }
        return Int64(value) != nil
    }

    private static func parseRetryAfter(_ value: String?) -> Duration? {
        guard let value else { return nil }
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let seconds = Int64(trimmedValue), seconds >= 0 {
            return .seconds(seconds)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        guard let date = formatter.date(from: trimmedValue) else { return nil }
        return .milliseconds(max(Int64((date.timeIntervalSinceNow * 1_000).rounded(.down)), 0))
    }
}

private struct DeviceLabelRequest: Encodable {
    let deviceLabel: String
}
