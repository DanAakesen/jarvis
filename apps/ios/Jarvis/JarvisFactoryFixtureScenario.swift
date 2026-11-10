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
    static var taskDetailLiveUpdatesEnabled: Bool {
#if DEBUG && targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        return ["--ui-test-navigation", "--ui-test-notification-tasks", "--ui-test-factory-long-detail"]
            .allSatisfy(arguments.contains) &&
            ["--ui-test-factory-live-replay", "--ui-test-factory-offline-replay"]
            .contains(where: arguments.contains)
#else
        return false
#endif
    }

    static func makeClient(state: JarvisFactoryPreviewState) throws -> JarvisFactoryClient {
        let scenario = Data(scenario(for: state).utf8)
        var history = Data(#"{"version":1,"interactions":[\#(taskDetailResponse)]}"#.utf8)
#if DEBUG && targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        if ["--ui-test-navigation", "--ui-test-notification-tasks", "--ui-test-factory-long-detail"]
            .allSatisfy(arguments.contains) {
            history = try longTaskHistory()
        }
#endif
        let transport = try TaskHistoryFixtureTransport(
            base: FixtureTransport(scenario: scenario),
            history: history
        )
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
              var cards = value[key] else { return "[]" }
#if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--ui-test-notification-tasks"), key == "in_progress",
           var issueCard = cards.first as? [String: Any], var issue = issueCard["issue"] as? [String: Any] {
            issue["number"] = 11
            issue["title"] = "Synthetic issue without a task"
            issue["url"] = "https://github.com/example/example/issues/11"
            issueCard["issue"] = issue
            issueCard["task"] = NSNull()
            issueCard["pr"] = NSNull()
            cards.append(issueCard)
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-test-page-chrome"), key == "in_progress",
           let original = cards.first as? [String: Any] {
            cards = (0..<16).map { offset -> [String: Any] in
                var card = original
                var issue = card["issue"] as! [String: Any]
                issue["number"] = 100 + offset
                issue["title"] = "Synthetic scrolling task \(offset + 1)"
                issue["url"] = "https://github.com/example/example/issues/\(100 + offset)"
                card["issue"] = issue
                var task = card["task"] as! [String: Any]
                task["id"] = String(200 + offset)
                card["task"] = task
                return card
            }
        }
#endif
        guard let array = try? JSONSerialization.data(withJSONObject: cards),
              let text = String(data: array, encoding: .utf8) else {
            return "[]"
        }
        return text
    }

#if DEBUG && targetEnvironment(simulator)
    private static func longTaskHistory() throws -> Data {
        let original = try JSONSerialization.jsonObject(with: Data(taskDetailResponse.utf8)) as! [String: Any]
        var body = (original["response"] as! [String: Any])["body"] as! [String: Any]
        body["request"] = """
        Synthetic native task-detail acceptance request. Use only example/example and fixture task 21.

        Review the release branch before preparing a pull request. Read the existing implementation and preserve the original request exactly, including paragraph breaks, punctuation, and the Danish words æble, øvelse, and åbning.

        Trace the public runner messages separately from private thought chunks and low-level notifications. Keep useful check results, task transitions, artifact references, and earlier failures visible without flooding the main task page.

        An earlier workspace reported disk_low. Retain that historical error even after newer progress arrives; do not mistake a later disk snapshot for proof that the failure never happened.

        Verify the recorded sandbox minutes and provider usage. Missing prices, token totals, and premium requests are unavailable, not zero. Do not invent measurements or contact a live runner.

        Check the collapsed request, expand it to read every paragraph, and collapse it again. The original source must remain unchanged after history pagination and pull-to-refresh.

        Acceptance ends here: synthetic task 21 only; no production task may be opened, changed, resumed, or retried.
        """
        let formatter = ISO8601DateFormatter()
        let start = Date(timeIntervalSince1970: 1_793_347_200)
        let events: [[String: Any]] = (0..<1_200).map { offset in
            let page = offset / 100 + 1
            let position = offset % 100
            var type = "acp_notification"
            var summary = "Synthetic runner notification"
            var payload: [String: Any] = [
                "invocationId": "fixture-invocation-\(page)",
                "data": [
                    "method": "session/update",
                    "params": [
                        "sessionId": "fixture-session",
                        "update": [
                            "sessionUpdate": "agent_thought_chunk",
                            "content": ["type": "text", "text": "PRIVATE_THOUGHT_SENTINEL_1708"]
                        ]
                    ]
                ]
            ]
            switch position {
            case 0:
                type = "state_changed"
                summary = "Synthetic progress page \(page)"
                payload = ["from": "Ready", "to": "Running"]
            case 1:
                type = offset == 1 ? "disk_low" : "disk_snapshot"
                summary = offset == 1 ? "Synthetic earlier disk_low: workspace needs attention" : "Synthetic workspace disk snapshot"
                payload = ["data": ["freeBytes": 1_073_741_824, "usedBytes": 2_147_483_648, "totalBytes": 3_221_225_472]]
            case 80...82:
                let chunks = ["Synthetic public progress \(page): ", "reviewed the release.\n", "Checks and artifacts follow."]
                payload = [
                    "invocationId": "fixture-invocation-\(page)",
                    "data": [
                        "method": "session/update",
                        "params": [
                            "sessionId": "fixture-session",
                            "update": [
                                "sessionUpdate": "agent_message_chunk",
                                "content": ["type": "text", "text": chunks[position - 80]]
                            ]
                        ]
                    ]
                ]
            case 90:
                payload = [
                    "invocationId": "fixture-invocation-\(page)",
                    "data": [
                        "method": "session/update",
                        "params": [
                            "sessionId": "fixture-session",
                            "update": [
                                "sessionUpdate": "tool_call_update",
                                "title": "Synthetic workspace inspection \(page)", "status": "completed",
                                "rawOutput": "LOW_LEVEL_SENTINEL_1708"
                            ]
                        ]
                    ]
                ]
            case 91:
                type = "checks_started"
                summary = "Synthetic checks started \(page)"
                payload = ["checks": "pending"]
            case 92:
                type = "checks_completed"
                summary = "Synthetic checks passed \(page)"
                payload = ["conclusion": "success"]
            case 93:
                type = "pull_request_updated"
                summary = "Synthetic pull request #19 updated \(page)"
                payload = ["number": 19, "url": "https://github.com/example/example/pull/19"]
            case 94:
                type = "artifact_created"
                summary = "Synthetic test report page \(page)"
                payload = ["name": "fixture-report-\(page).xml"]
            default:
                if position.isMultiple(of: 3) || position >= 95 {
                    payload = [
                        "invocationId": "fixture-invocation-\(page)",
                        "data": [
                            "method": "session/heartbeat",
                            "params": ["sessionId": "fixture-session", "metadata": "LOW_LEVEL_SENTINEL_1708"]
                        ]
                    ]
                }
            }
            if offset == 1_199, taskDetailLiveUpdatesEnabled {
                type = "task_result"
                summary = "Synthetic latest progress 1200"
                payload = ["result": summary]
            }
            return [
                "id": String(offset + 1), "taskId": "21", "type": type, "summary": summary,
                "payload": payload, "payloadTruncated": false, "source": "runner",
                "at": formatter.string(from: start.addingTimeInterval(Double(offset)))
            ]
        }
        // The real API is oldest-first with 100-record pages; include the empty terminal page.
        let interactions: [[String: Any]] = stride(from: 0, through: events.count, by: 100).map { offset in
            var interaction = original
            var page = body
            page["events"] = Array(events.dropFirst(offset).prefix(100))
            interaction["query"] = ["eventLimit": "100", "eventOffset": String(offset)]
            interaction["response"] = ["statusCode": 200, "body": page]
            return interaction
        }
        return try JSONSerialization.data(withJSONObject: ["version": 1, "interactions": interactions])
    }
#endif

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
          "id":"5","type":"disk_snapshot","summary":"Synthetic workspace disk snapshot",
          "payload":{"data":{"freeBytes":1073741824,"usedBytes":2147483648,"totalBytes":3221225472}},
          "payloadTruncated":false,"source":"runner","at":"2026-10-30T09:00:00Z"
        },{
          "id":"6","type":"artifact_created","summary":"Synthetic test report",
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

/// Task detail and the board can load independently when a notification opens a task.
private struct TaskHistoryFixtureTransport: HTTPTransport {
    let base: FixtureTransport
    let history: Data

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.url.path == "/api/factory/tasks/21" {
            guard let scenario = try JSONSerialization.jsonObject(with: history) as? [String: Any],
                  let interactions = scenario["interactions"] as? [[String: Any]] else {
                throw FixtureTransportError.invalidScenario
            }
            var query: [String: String] = [:]
            for item in URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
                guard let value = item.value, query[item.name] == nil else {
                    throw FixtureTransportError.requestMismatch
                }
                query[item.name] = value
            }
            let matches = interactions.filter {
                $0["method"] as? String == request.method.rawValue &&
                $0["path"] as? String == request.url.path &&
                ($0["query"] as? [String: String] ?? [:]) == query
            }
            guard matches.count == 1 else { throw FixtureTransportError.requestMismatch }
            // FixtureTransport is ordered and single-use; select this page before replaying it.
            let page = try JSONSerialization.data(withJSONObject: [
                "version": scenario["version"] ?? 1, "interactions": matches
            ])
            return try await FixtureTransport(scenario: page).send(request)
        }
        return try await base.send(request)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
#if DEBUG && targetEnvironment(simulator)
        if JarvisFactoryFixtureScenario.taskDetailLiveUpdatesEnabled,
           request.url.path == "/api/factory/tasks/21/events" {
            guard request.method == .get else { throw FixtureTransportError.requestMismatch }
            if ProcessInfo.processInfo.arguments.contains("--ui-test-factory-offline-replay") {
                throw HTTPTransportFailure.network
            }
            let cursorValue = request.headers.first {
                $0.key.caseInsensitiveCompare("Last-Event-ID") == .orderedSame
            }?.value ?? "0"
            guard let cursor = Int(cursorValue), (0...1_200).contains(cursor),
                  let scenario = try JSONSerialization.jsonObject(with: history) as? [String: Any],
                  let interactions = scenario["interactions"] as? [[String: Any]] else {
                throw FixtureTransportError.invalidScenario
            }
            let events = try interactions.flatMap { interaction -> [[String: Any]] in
                guard let response = interaction["response"] as? [String: Any],
                      let body = response["body"] as? [String: Any],
                      let events = body["events"] as? [[String: Any]] else {
                    throw FixtureTransportError.invalidScenario
                }
                return events
            }
            let frames: [Data] = try events.compactMap { event in
                guard let id = event["id"] as? String, let number = Int(id) else {
                    throw FixtureTransportError.invalidScenario
                }
                guard number > cursor else { return nil }
                let json = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
                return Data("event: task\nid: \(id)\ndata: \(String(decoding: json, as: UTF8.self))\n\n".utf8)
            }
            let batches = stride(from: 0, to: frames.count, by: 100).map { offset in
                frames.dropFirst(offset).prefix(100).reduce(into: Data()) { $0.append($1) }
            }
            let playback = FactoryTaskReplayPlayback(
                chunks: batches + [Data("event: ready\ndata: {}\n\n".utf8)]
            )
            return HTTPStreamResponse(
                statusCode: 200,
                headers: ["Content-Type": "text/event-stream"],
                body: AsyncThrowingStream(unfolding: { try await playback.next() })
            )
        }
#endif
        return try await base.stream(request)
    }
}

#if DEBUG && targetEnvironment(simulator)
private actor FactoryTaskReplayPlayback {
    let chunks: [Data]
    private var index = 0

    init(chunks: [Data]) { self.chunks = chunks }

    func next() async throws -> Data? {
        try Task.checkCancellation()
        // Leave time to inspect the oldest HTTP page and use navigation before replay.
        try await Task.sleep(for: index == 0 ? .seconds(30) : .milliseconds(500))
        if index < chunks.count {
            let chunk = chunks[index]
            index += 1
            return chunk
        }
        // A ready signal is not EOF. Keep the stream alive until its consumer cancels.
        try await Task.sleep(for: .seconds(30))
        return Data(": synthetic task 21 keepalive\n\n".utf8)
    }
}
#endif

private actor FactoryScreenshotTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct FactoryScreenshotTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
