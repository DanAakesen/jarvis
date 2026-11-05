import Foundation
import JarvisCore

/// A deterministic backend for the Usage, Status and Proactive pages, used by the UI tests (`--ui-test-navigation`).
/// It answers by route, not in order, so the pages can reload, change period and poll freely. Settings edits are
/// kept for the life of the process so a saved change shows on the page afterwards.
/// `--ui-test-insights=error|offline|empty` makes every read fail, fail offline or come back empty;
/// `--ui-test-insights-save-fails-once` makes the first settings save fail so the retry can be exercised.
actor JarvisInsightsFixtureTransport: HTTPTransport {
    enum Mode: String {
        case normal
        case empty
        case error
        case offline
        case loading
    }

    static let now = ISO8601DateFormatter().date(from: "2026-10-31T12:00:00Z")!

    private let mode: Mode
    private var failNextSave: Bool
    private var revision = 1
    private var paused = false
    private var budget = 50
    private var scope = "all"
    private var guidance = "Keep it short."
    private var feeds: [String] = []
    private var sourceEnabled: [String: Bool] = [
        "todos": true, "calendar": true, "mail": true, "weather": true,
        "factory": true, "news": false, "travel": true, "x": false,
    ]
    private var categoryEnabled: [String: Bool] = [
        "deadline": true, "clash": true, "travel": true, "todo": true, "prep": true,
        "news": false, "weather": true, "status": true, "suggestion": true,
    ]
    private var itemStates: [String: String] = [:]
    private var extraRuns: [[String: Any]] = []

    init(arguments: [String] = ProcessInfo.processInfo.arguments) {
        let raw = arguments.first { $0.hasPrefix("--ui-test-insights=") }?
            .dropFirst("--ui-test-insights=".count)
        mode = raw.flatMap { Mode(rawValue: String($0)) } ?? .normal
        failNextSave = arguments.contains("--ui-test-insights-save-fails-once")
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if mode == .loading { try await Task.sleep(for: .seconds(60)) }
        if mode == .offline { throw HTTPTransportFailure.network }
        if mode == .error { return Self.response(500, ["error": "internal_error"]) }
        let components = URLComponents(url: request.url, resolvingAgainstBaseURL: false)
        let path = (components?.path ?? "").replacingOccurrences(of: "/api", with: "", options: .anchored)
        let query = Dictionary(
            (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") },
            uniquingKeysWith: { first, _ in first }
        )
        switch (request.method, path) {
        case (.get, "/usage"): return Self.response(200, usage(period: query["period"] ?? "30d"))
        case (.get, "/status"): return Self.response(200, Self.status())
        case (.get, "/proactive/status"): return Self.response(200, proactiveStatus())
        case (.get, "/proactive/items"): return Self.response(200, ["items": items(all: query["state"] == "all")])
        case (.get, "/proactive/runs"): return Self.response(200, ["runs": runs()])
        case (.post, "/proactive/runs"): return startRun()
        case (.get, "/proactive/settings"): return Self.response(200, settings())
        case (.patch, "/proactive/settings"): return patchSettings(request.body)
        default:
            if request.method == .post, path.hasPrefix("/proactive/items/"), path.hasSuffix("/feedback") {
                return feedback(path: path, body: request.body)
            }
            return Self.response(404, ["error": "not_found"])
        }
    }

    // MARK: Helpers

    private static func response(_ status: Int, _ object: Any) -> HTTPResponse {
        let body = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return HTTPResponse(statusCode: status, headers: ["content-type": "application/json"], body: body)
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func ago(days: Double = 0, hours: Double = 0, minutes: Double = 0) -> String {
        iso(now.addingTimeInterval(-(days * 86_400 + hours * 3_600 + minutes * 60)))
    }

    // MARK: Usage

    private func usage(period: String) -> [String: Any] {
        let days: Int
        switch period {
        case "7d": days = 7
        case "90d": days = 90
        case "all": days = 150
        default: days = 30
        }
        var entries: [[String: Any]] = []
        if mode != .empty {
            for day in 0..<days {
                let at = Self.ago(days: Double(day), hours: 1)
                let project: (String, String) = day % 3 == 0 ? ("p-ios", "Jarvis iOS") : ("p-web", "Jarvis web")
                entries.append([
                    "taskId": "task-\(day % 4)", "taskTitle": "Task \(day % 4 + 1)",
                    "projectId": project.0, "projectName": project.1,
                    "agent": "codex", "source": "sandbox", "metric": "minutes",
                    "quantity": Double(10 + day % 5), "costDkk": 1.5 + Double(day % 4) * 0.5,
                    "at": at, "estimated": false,
                ])
                if day % 2 == 0 {
                    entries.append([
                        "taskId": NSNull(), "taskTitle": NSNull(), "projectId": NSNull(), "projectName": NSNull(),
                        "agent": "jarvis", "source": "jarvis_model", "metric": "input_tokens",
                        "quantity": 20_000.0, "costDkk": 0.8, "at": at, "estimated": true,
                    ])
                }
                if day % 3 == 1 {
                    entries.append([
                        "taskId": "task-1", "taskTitle": "Task 2", "projectId": "p-ios", "projectName": "Jarvis iOS",
                        "agent": "copilot", "source": "copilot", "metric": "premium_requests",
                        "quantity": 4.0, "costDkk": 1.2, "at": at, "estimated": false,
                    ])
                }
            }
        }
        var from: Any = NSNull()
        if days < 150 { from = Self.ago(days: Double(days)) }
        return [
            "period": period,
            "from": from,
            "to": Self.iso(Self.now),
            "codexToolCallsToday": mode == .empty ? [] : [["tool": "web_research", "count": "3"]],
            "entries": entries,
            "totalEntries": String(entries.count),
            "truncated": false,
            "toolCalls": mode == .empty ? [] : [["tool": "web_research", "count": "5", "costStatus": "unverified"], ["tool": "image_generation", "count": "2", "costStatus": "unverified"]],
            "healthToolUsage": [
                "date": "2026-10-31",
                "tools": mode == .empty ? [] : [["tool": "web_search", "count": "5"], ["tool": "calendar", "count": "2"]],
            ],
        ]
    }

    // MARK: Status

    private static func status() -> [String: Any] {
        func entry(_ id: String, _ status: String, _ details: [String: Any]? = nil) -> [String: Any] {
            var value: [String: Any] = ["id": id, "status": status, "checkedAt": ago(minutes: 2)]
            if let details { value["details"] = details }
            return value
        }
        return [
            "checkedAt": ago(minutes: 2),
            "entries": [
                entry("database", "ok"),
                entry("foundry.chat", "ok"),
                entry("foundry.voice", "degraded", ["catalogue": "fallback"]),
                entry("foundry.embeddings", "ok"),
                entry("vault_index", "ok"),
                entry("github_app", "ok"),
                entry("google", "down", ["reason": "token_expired"]),
                entry("pc_bridge", "unknown", ["configured": false]),
                entry("runner", "ok"),
                entry("deployed_commit", "ok"),
                entry("last_error", "ok"),
            ],
            "smoke": [
                "checkedAt": ago(hours: 1),
                "entries": [
                    ["id": "chat", "status": "ok", "checkedAt": ago(hours: 1)],
                    ["id": "voice", "status": "ok", "checkedAt": ago(hours: 1)],
                    ["id": "vault", "status": "degraded", "checkedAt": ago(hours: 1), "reason": "slow"],
                ],
            ],
            "vaultMirror": [
                "state": "healthy",
                "lastSuccessAt": ago(minutes: 10),
                "writeBack": "dry-run",
                "counts": [
                    "approved": 12, "pushed": 4, "writtenBack": 0, "deleted": 1, "conflicts": 0,
                    "skipped": 2, "credentialMatches": 0, "pendingWriteBack": 0, "consecutiveFailures": 0,
                ],
                "conflictPaths": [],
            ],
        ]
    }

    // MARK: Proactive

    private static let itemIDs = [
        "6f1c0d5a-0b0e-4d6b-9d0e-000000000001",
        "6f1c0d5a-0b0e-4d6b-9d0e-000000000002",
        "6f1c0d5a-0b0e-4d6b-9d0e-000000000003",
        "6f1c0d5a-0b0e-4d6b-9d0e-000000000004",
        "6f1c0d5a-0b0e-4d6b-9d0e-000000000005",
    ]

    private func item(_ index: Int) -> [String: Any] {
        let definitions: [(String, String, String, String, String?, String)] = [
            ("Flight departs tomorrow 07:40", "Check in opens in two hours. Bring your passport.", "travel", "time_critical",
             "2026-11-01T06:40:00Z", "new"),
            ("Weekly report is due Friday", "The report has no draft yet.", "deadline", "normal", "2026-11-06T15:00:00Z", "seen"),
            ("Rain this afternoon", "Rain from 15:00. Take a jacket.", "weather", "fyi", nil, "new"),
            ("Old calendar clash", "Two meetings overlapped last week.", "clash", "normal", nil, "dismissed"),
            ("Renew library card", "Expires next month.", "todo", "fyi", nil, "snoozed"),
        ]
        let definition = definitions[index]
        let id = Self.itemIDs[index]
        let state = itemStates[id] ?? definition.5
        return [
            "id": id, "kind": "finding", "title": definition.0, "body": definition.1,
            "category": definition.2, "urgency": definition.3,
            "dueAt": definition.4.map { $0 as Any } ?? NSNull(),
            "evidence": [["source": "calendar", "label": "Calendar event", "observedAt": Self.ago(minutes: 20)]],
            "state": state,
            "snoozedUntil": (state == "snoozed" ? "2026-11-02T06:00:00Z" : nil).map { $0 as Any } ?? NSNull(),
            "feedback": NSNull(), "runId": NSNull(), "todoAdded": false, "language": "en",
            "createdAt": Self.ago(hours: Double(index) + 2),
        ]
    }

    private func items(all: Bool) -> [[String: Any]] {
        if mode == .empty { return [] }
        let open = Set(["new", "seen"])
        return (0..<Self.itemIDs.count).map(item).filter { all || open.contains($0["state"] as? String ?? "") }
    }

    private func budgetState() -> (spend: Double, state: String) {
        let spend = 12.5
        let limit = Double(budget)
        if limit <= 0 || spend >= limit { return (spend, "exhausted") }
        return (spend, spend >= limit * 0.8 ? "warn" : "ok")
    }

    private func proactiveStatus() -> [String: Any] {
        let order = ["todos", "calendar", "mail", "weather", "factory", "news", "travel", "x"]
        let sources: [[String: Any]] = order.map { id in
            let enabled = sourceEnabled[id] ?? false
            var value: [String: Any] = ["id": id, "enabled": enabled]
            if !enabled {
                value["state"] = "disabled"
            } else if id == "mail" {
                value["state"] = "unavailable"
                value["reason"] = "not_connected"
            } else if id == "travel" {
                value["state"] = "not_run"
            } else {
                value["state"] = "ok"
                value["observedAt"] = Self.ago(minutes: 8)
            }
            return value
        }
        let budgetInfo = budgetState()
        return [
            "paused": paused,
            "quietNow": false,
            "nextSlotAt": "2026-10-31T13:00:00Z",
            "lastRun": runs().first.map { $0 as Any } ?? NSNull(),
            "budget": [
                "month": "2026-10", "monthlyLimitDkk": Double(budget),
                "estimatedSpendDkk": budgetInfo.spend, "state": budgetInfo.state,
            ],
            "sources": sources,
        ]
    }

    private func runs() -> [[String: Any]] {
        let seeded: [[String: Any]] = [
            [
                "id": "run-2", "trigger": "scheduled", "slot": "2026-10-31T11:00:00Z", "status": "done",
                "reason": NSNull(), "startedAt": Self.ago(hours: 1), "finishedAt": Self.ago(hours: 1), "findingCount": 3,
            ],
            [
                "id": "run-1", "trigger": "scheduled", "slot": "2026-10-31T09:00:00Z", "status": "done",
                "reason": NSNull(), "startedAt": Self.ago(hours: 3), "finishedAt": Self.ago(hours: 3), "findingCount": 1,
            ],
        ]
        return extraRuns.reversed() + seeded
    }

    private func startRun() -> HTTPResponse {
        if paused { return Self.response(409, ["error": "paused"]) }
        let run: [String: Any] = [
            "id": "run-manual-\(extraRuns.count + 1)", "trigger": "manual", "slot": NSNull(), "status": "done",
            "reason": NSNull(), "startedAt": Self.iso(Self.now), "finishedAt": Self.iso(Self.now), "findingCount": 0,
        ]
        extraRuns.append(run)
        return Self.response(202, ["run": run])
    }

    private func settings() -> [String: Any] {
        let sources = ["todos", "calendar", "mail", "weather", "factory", "news", "travel", "x"]
        let categories = ["deadline", "clash", "travel", "todo", "prep", "news", "weather", "status", "suggestion"]
        return [
            "paused": paused,
            "monthlyBudgetDkk": budget,
            "sources": sources.map { ["id": $0, "enabled": sourceEnabled[$0] ?? false] },
            "categories": categories.map { ["id": $0, "enabled": categoryEnabled[$0] ?? false] },
            "suggestionScope": scope,
            "newsFeeds": feeds,
            "guidance": guidance,
            "revision": String(format: "%064x", revision),
            "preferences": ["Prefers short summaries", "Do not suggest anything before 08:00"],
        ]
    }

    private func patchSettings(_ body: Data?) -> HTTPResponse {
        if failNextSave {
            failNextSave = false
            return Self.response(500, ["error": "internal_error"])
        }
        guard let body, let patch = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              patch["expectedRevision"] as? String == String(format: "%064x", revision) else {
            return Self.response(409, ["error": "settings_changed"])
        }
        if let value = patch["paused"] as? Bool { paused = value }
        if let value = patch["monthlyBudgetDkk"] as? Int { budget = value }
        if let value = patch["suggestionScope"] as? String { scope = value }
        if let value = patch["guidance"] as? String { guidance = value }
        if let value = patch["newsFeeds"] as? [String] { feeds = value }
        for toggle in patch["sources"] as? [[String: Any]] ?? [] {
            if let id = toggle["id"] as? String, let enabled = toggle["enabled"] as? Bool { sourceEnabled[id] = enabled }
        }
        for toggle in patch["categories"] as? [[String: Any]] ?? [] {
            if let id = toggle["id"] as? String, let enabled = toggle["enabled"] as? Bool { categoryEnabled[id] = enabled }
        }
        revision += 1
        return Self.response(200, settings())
    }

    private func feedback(path: String, body: Data?) -> HTTPResponse {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count == 4, let index = Self.itemIDs.firstIndex(of: parts[2]),
              let body, let payload = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let action = payload["action"] as? String else {
            return Self.response(404, ["error": "not_found"])
        }
        switch action {
        case "seen": itemStates[parts[2]] = "seen"
        case "dismiss": itemStates[parts[2]] = "dismissed"
        case "snooze": itemStates[parts[2]] = "snoozed"
        default: break
        }
        return Self.response(200, item(index))
    }
}

enum JarvisInsightsFixture {
    /// One client over one fixture backend, shared by the three pages so edits made in one place show in the others.
    static func makeClient() -> JarvisClient? {
        try? JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: JarvisInsightsFixtureTransport(),
            tokenStore: JarvisInsightsFixtureTokenStore(),
            accessTokenProvider: JarvisInsightsFixtureTokenProvider()
        )
    }
}

private actor JarvisInsightsFixtureTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct JarvisInsightsFixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
