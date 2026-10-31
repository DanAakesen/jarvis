import Foundation
import JarvisCore

enum JarvisHealthLiftFixture {
    static func makeClient(language: JarvisAppLanguage, empty: Bool) throws -> JarvisHealthClient {
        let names = language == .da ? ["Squat", "Dødløft", "Bænkpres"] : ["Squat", "Deadlift", "Bench press"]
        let lifts: [[String: Any]] = empty ? [] : names.enumerated().map { index, name in
            [
                "id": "00000000-0000-4000-8000-00000000000\(index)",
                "exerciseName": name, "weightKg": [80, 120, 60][index],
                "reps": 5, "sets": 3, "performedAt": "2026-10-31T09:00:00Z",
            ]
        }
        func interaction(_ method: String, _ path: String, _ body: [String: Any]) -> [String: Any] {
            ["method": method, "path": "/api/daily/\(path)",
             "response": ["statusCode": 200, "body": body]]
        }
        let liftResult: [String: Any] = [
            "source": "daily.health.lifts", "items": lifts,
            "status": lifts.isEmpty ? "empty" : "available",
            "coverage": ["returned": lifts.count, "hasMore": false, "next": NSNull()],
        ]
        let scenario: [String: Any] = [
            "version": 1,
            "interactions": [
                interaction("GET", "capabilities", [
                    "module": "daily", "version": 6, "sources": ["daily.health.lifts"],
                ]),
                interaction("GET", "training-targets", ["targets": [:]]),
                interaction("GET", "nutrition-targets", ["targets": [:]]),
                interaction("POST", "query", liftResult),
                interaction("POST", "query", liftResult),
            ],
        ]
        let transport = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: scenario))
        return JarvisHealthClient(client: try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: HealthLiftFixtureTokenStore(),
            accessTokenProvider: HealthLiftFixtureTokenProvider()
        ))
    }
}

private actor HealthLiftFixtureTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct HealthLiftFixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
