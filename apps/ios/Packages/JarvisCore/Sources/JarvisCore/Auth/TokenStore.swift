public protocol TokenStore: Sendable {
    func read() async throws -> String?
    func write(_ token: String) async throws
    func delete() async throws
}

public protocol AccessTokenProvider: Sendable {
    func currentToken(for request: HTTPRequest) async throws -> String
    func requestSignIn() async
}
