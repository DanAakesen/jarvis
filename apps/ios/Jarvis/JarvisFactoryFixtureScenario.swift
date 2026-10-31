import Foundation
import JarvisCore

struct JarvisFactoryScreenshotConfiguration {
    let state: JarvisFactoryPreviewState
    let language: JarvisAppLanguage?

    static func parse(arguments: [String]) -> JarvisFactoryScreenshotConfiguration? {
        guard arguments.contains("--screenshot-factory-fixture"),
              let value = arguments.first(where: { $0.hasPrefix("--screenshot-factory-state=") })?
                .split(separator: "=", maxSplits: 1).last,
              let state = JarvisFactoryPreviewState(rawValue: String(value)) else {
            return nil
        }
        let languageValue = arguments.first(where: { $0.hasPrefix("--screenshot-factory-language=") })?
            .split(separator: "=", maxSplits: 1).last
            .flatMap { JarvisAppLanguage(rawValue: String($0)) }
        return JarvisFactoryScreenshotConfiguration(state: state, language: languageValue)
    }
}

enum JarvisFactoryFixtureScenario {
    static func makeClient(state: JarvisFactoryPreviewState) throws -> JarvisFactoryClient {
        let scenario = Data(scenario(for: state).utf8)
        let transport = try FixtureTransport(scenario: scenario)
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: FactoryScreenshotTokenStore(),
            accessTokenProvider: FactoryScreenshotTokenProvider()
        )
        return JarvisFactoryClient(client: client)
    }

    private static func scenario(for state: JarvisFactoryPreviewState) -> String {
        let projectResponse = #"""
        {
          "method":"GET","path":"/api/factory/projects",
          "response":{"statusCode":200,"body":[{
            "id":"7","name":"Example project","repo":"example/example","default_branch":"main",
            "default_agent":"copilot","policy":"deliver_pr"
          }]}
        }
        """#
        if state == .loading {
            return #"""
            {"version":1,"interactions":[
              \#(projectResponse)
            ]}
            """#
        }
        let releasesResponse = #"""
        {
          "method":"GET","path":"/api/factory/projects/7/releases",
          "response":{"statusCode":200,"body":{
            "project":{"id":"7","name":"Example project","repo":"example/example","defaultBranch":"main"},
            "releases":[{
              "id":"31","version":"v2.1.0","sha":"abcdef1234567890","status":"released",
              "createdAt":"2026-10-30T09:00:00Z","releasedAt":"2026-10-30T10:00:00Z"
            }],
            "pullRequests":[{
              "id":"19","number":19,"branch":"factory/example","headSha":"abcdef1234567890",
              "state":"closed","checks":"success","taskId":"21"
            }],
            "workflowRuns":[{
              "id":"51","workflow":"iOS CI","trigger":"push","headSha":"abcdef1234567890",
              "status":"completed","conclusion":"success","startedAt":"2026-10-30T09:10:00Z",
              "completedAt":"2026-10-30T09:15:00Z","releaseId":"31","pullRequestNumber":19,"taskId":"21"
            }],
            "deployments":[{
              "id":"61","releaseId":"31","environment":"production","status":"success",
              "at":"2026-10-30T10:00:00Z"
            }],
            "graph":{
              "fetchedAt":"2026-10-30T10:00:00Z","truncated":false,
              "commits":[{
                "sha":"abcdef1234567890","message":"Add a synthetic release example",
                "author":"Example contributor","committedAt":"2026-10-30T08:30:00Z","parents":[]
              }]
            }
          }}
        }
        """#
        let boardResponse = boardInteraction(for: state)
        var interactions = [projectResponse]
        if state.segment == .releases {
            interactions.append(releasesResponse)
        } else {
            interactions.append(boardResponse)
            if state == .detail || state == .steer {
                interactions.append(taskDetailResponse)
            }
        }
        let encodedInteractions = interactions.joined(separator: ",")
        return #"{"version":1,"interactions":[\#(encodedInteractions)]}"#
    }

    private static func boardInteraction(for state: JarvisFactoryPreviewState) -> String {
        if state == .error {
            return #"""
            {
              "method":"GET","path":"/api/factory/board","query":{"project":"7"},
              "response":{"statusCode":503,"body":{"error":"Synthetic fixture failure"}}
            }
            """#
        }
        let stale = state == .stale || state == .offline || state == .reconnecting
        let cards = state == .empty ? #"""
        {"in_progress":[],"in_review":[],"ready":[],"backlog":[],"needs_dan":[],"done":[]}
        """# : #"""
        {
          "in_progress":[{
            "issue":{
              "number":9,"url":"https://github.com/example/example/issues/9","title":"Synthetic release task",
              "taskCode":null,"labels":["factory"],"worker":"Copilot","state":"open",
              "updatedAt":"2026-10-30T08:00:00Z","closedAt":null,"blockedBy":[3]
            },
            "pr":{"number":19,"url":"https://github.com/example/example/pull/19","draft":false,"checks":"pending"},
            "task":{
              "id":"21","state":"Running","agent":"copilot","activity":"Synthetic fixture task",
              "attemptCount":1,"branch":"factory/synthetic","startedAt":"2026-10-30T08:00:00Z",
              "latestSessionEndReason":null
            }
          }],
          "in_review":[],"ready":[],"backlog":[],
          "needs_dan":[{
            "issue":{
              "number":10,"url":"https://github.com/example/example/issues/10","title":"Synthetic decision",
              "taskCode":null,"labels":["needs-decision"],"worker":"Codex","state":"open",
              "updatedAt":"2026-10-30T08:30:00Z","closedAt":null,"blockedBy":[]
            },
            "pr":null,
            "task":{
              "id":"22","state":"NeedsAttention","agent":"codex","activity":"Synthetic decision",
              "attemptCount":1,"branch":null,"startedAt":null,"latestSessionEndReason":"crashed"
            }
          }],
          "done":[]
        }
        """#
        let columnList = [
            ("in_progress", "in_progress"),
            ("in_review", "in_review"),
            ("ready", "ready"),
            ("backlog", "backlog"),
            ("needs_dan", "needs_dan"),
            ("done", "done"),
        ].map { id, key in
            #"{"id":"\#(id)","cards":\#(jsonArray(for: key, in: cards))}"#
        }.joined(separator: ",")
        return #"""
        {
          "method":"GET","path":"/api/factory/board","query":{"project":"7"},
          "response":{"statusCode":200,"body":{
            "project":{"id":"7","repo":"example/example"},
            "fetchedAt":"2026-10-30T10:00:00Z","stale":\#(stale),
            "columns":[\#(columnList)]
          }}
        }
        """#
    }

    private static func jsonArray(for key: String, in source: String) -> String {
        guard let data = source.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: [Any]],
              let cards = value[key],
              let array = try? JSONSerialization.data(withJSONObject: cards),
              let text = String(data: array, encoding: .utf8) else {
            return "[]"
        }
        return text
    }

    private static let taskDetailResponse = #"""
    {
      "method":"GET","path":"/api/factory/tasks/21",
      "query":{"eventLimit":"100","eventOffset":"0"},
      "response":{"statusCode":200,"body":{
        "id":"21","projectId":"7","issueNumber":9,"originMessageId":null,
        "title":"Synthetic release task","request":"Review the synthetic release and report any blocking checks.",
        "source":"board","agent":"copilot","modelOverride":null,"reasoningOverride":null,"state":"Running",
        "activity":"Synthetic fixture task","priority":0,"attemptCount":1,"nextAttemptAt":null,
        "branch":"factory/synthetic","pullRequest":{"number":19,"url":"https://github.com/example/example/pull/19","state":"open"},
        "checks":"pending","checkConclusion":null,"usageSummary":{"inputTokens":1200,"outputTokens":450,"costDkk":0.12},
        "latestSessionEndReason":null,"createdAt":"2026-10-30T07:30:00Z",
        "startedAt":"2026-10-30T08:00:00Z","finishedAt":null,
        "events":[{
          "id":"5","taskId":"21","type":"disk_snapshot","summary":"Synthetic workspace disk snapshot",
          "payload":{"data":{"freeBytes":1073741824,"usedBytes":2147483648,"totalBytes":3221225472}},
          "payloadTruncated":false,"source":"runner","at":"2026-10-30T09:00:00Z"
        },{
          "id":"6","taskId":"21","type":"artifact_created","summary":"Synthetic test report",
          "payload":{"name":"fixture-report.xml"},"payloadTruncated":false,"source":"runner",
          "at":"2026-10-30T09:15:00Z"
        }],
        "usage":[{
          "id":"usage-1","source":"sandbox","metric":"minutes","quantity":12,
          "costDkk":null,"sandboxSessionId":"fixture-session","at":"2026-10-30T09:15:00Z","estimated":true
        }]
      }}
    }
    """#
}

private actor FactoryScreenshotTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct FactoryScreenshotTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
