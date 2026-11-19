import Foundation
import JarvisCore

/// In-memory settings only. Native field editing checks never write owner settings.
actor JarvisSettingsFixtureTransport: HTTPTransport {
    private var settings: Data
    private var training = ["gymSessionsPerWeek": 4, "runSessionsPerWeek": 1, "dailySteps": 6000]
    private var nutrition = ["restingKcal": 2200, "deficitKcal": 300, "proteinGrams": 160]
    private var reads: [String: Int] = [:]
    private var backgroundPiEnabled = false

    init(scenario: Data) throws {
        let root = try JSONSerialization.jsonObject(with: scenario) as! [String: Any]
        let interactions = root["interactions"] as! [[String: Any]]
        let response = interactions[0]["response"] as! [String: Any]
        settings = try JSONSerialization.data(withJSONObject: response["body"]!)
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let arguments = ProcessInfo.processInfo.arguments
        if request.method == .get {
            let path = request.url.path
            reads[path, default: 0] += 1
            let attempt = reads[path, default: 0]
            if arguments.contains("--settings-fixture-slow") {
                try await Task.sleep(for: .seconds(5))
            }
            if (arguments.contains("--settings-fixture-first-read-fails") && attempt == 1) ||
                (arguments.contains("--settings-fixture-refresh-fails") && attempt > 1) {
                return HTTPResponse(statusCode: 500)
            }
        }
        if request.url.path == "/api/memory", arguments.contains("--settings-fixture-memory") {
            let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?
                .first(where: { $0.name == "query" })?.value ?? ""
            let items: [[String: Any]] = query.isEmpty ? [
                ["id": "1", "type": "memory", "title": "Fixture memory", "content": "Fixture content", "folder": "General"],
            ] : []
            return HTTPResponse(statusCode: 200, body: try JSONSerialization.data(withJSONObject: [
                "items": items, "count": items.count, "limit": 50, "offset": 0, "hasMore": false,
            ]))
        }
        if request.url.path == "/api/pi/brain" {
            if request.method == .put, let body = request.body,
               let value = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               let enabled = value["enabled"] as? Bool {
                backgroundPiEnabled = enabled
            }
            return HTTPResponse(statusCode: 200, body: try backgroundPiStatus())
        }
        if request.url.path == "/api/settings" {
            if request.method == .patch, let data = request.body,
               let patch = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                var root = try JSONSerialization.jsonObject(with: settings) as! [String: Any]
                var values = root["settings"] as! [String: Any]
                func merged(_ before: [String: Any], _ after: [String: Any]) -> [String: Any] {
                    var result = before
                    for (key, value) in after {
                        if let nested = value as? [String: Any] {
                            result[key] = merged(result[key] as? [String: Any] ?? [:], nested)
                        } else { result[key] = value }
                    }
                    return result
                }
                if let areas = patch["settings"] as? [String: Any] {
                    values = merged(values, areas)
                } else if let area = patch["area"] as? String, let key = patch["key"] as? String {
                    values = merged(values, [area: [key: patch["value"] ?? NSNull()]])
                }
                root["settings"] = values
                settings = try JSONSerialization.data(withJSONObject: root)
            }
            return HTTPResponse(statusCode: 200, body: settings)
        }
        let isTraining = request.url.path == "/api/health/training-targets"
        guard isTraining || request.url.path == "/api/health/nutrition-targets" else {
            return HTTPResponse(statusCode: 404)
        }
        if request.method == .patch, let data = request.body,
           let values = try JSONSerialization.jsonObject(with: data) as? [String: Int] {
            if isTraining { training.merge(values) { _, new in new } }
            else { nutrition.merge(values) { _, new in new } }
        }
        let targets = isTraining ? training : nutrition
        let bounds = targets.mapValues { _ in [String: Any]() }.reduce(into: [String: Any]()) { result, item in
            result[item.key] = ["label": item.key, "unit": item.key == "dailySteps" ? "steps/day" : "sessions/week",
                                "min": 0, "max": item.key == "dailySteps" ? 100000 : (isTraining ? 21 : 10000)]
        }
        return HTTPResponse(statusCode: 200, body: try JSONSerialization.data(withJSONObject: [
            "targets": targets, "bounds": bounds, "missing": [], "updatedAt": "2026-11-07T12:00:00Z",
        ]))
    }

    private func backgroundPiStatus() throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "available": true,
            "enabled": backgroundPiEnabled,
            "updatedAt": "2026-11-19T15:00:00Z",
            "paused": false,
            "budget": ["limitDkk": 100, "spentDkk": 0.34, "state": "ok"],
            "month": ["wakes": 2, "costDkk": 0.34],
            "today": ["messages": 0, "usedTurns": 2, "allowedTurns": 12],
            "lastWake": NSNull(),
            "logPending": 0,
            "slots": [
                "used": 2, "allowed": 12, "remaining": 10, "lastAt": "2026-11-19T14:30:00Z",
                "lastActivationType": "event", "lastSatisfiedSlot": "2026-11-19T18:00",
                "nextAllowedAt": NSNull(), "quiet": false,
                "queue": ["pending": 0, "leased": 0, "retrying": 0],
            ],
            "situation": [
                "revision": 3, "asOf": "2026-11-19T14:30:00Z", "updatedAt": "2026-11-19T14:30:00Z",
                "staleSources": [], "missingSources": ["weather"], "disabledSources": [],
            ],
            "cost": [
                "coldSweepMinDkk": 0.14, "coldSweepMaxDkk": 0.28,
                "representativeToolTurnDkk": 0.17, "preflightWorstCaseDkk": 0.79,
                "estimatedDayMinDkk": 1.68, "estimatedDayMaxDkk": 3.36,
                "estimatedThirtyDayMinDkk": 50.4, "estimatedThirtyDayMaxDkk": 100,
            ],
        ])
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse { throw HTTPTransportFailure.network }
}
