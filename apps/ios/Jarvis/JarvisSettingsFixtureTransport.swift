import Foundation
import JarvisCore

/// In-memory settings only. Native field editing checks never write owner settings.
actor JarvisSettingsFixtureTransport: HTTPTransport {
    private var settings: Data
    private var training = ["gymSessionsPerWeek": 4, "runSessionsPerWeek": 1, "dailySteps": 6000]
    private var nutrition = ["restingKcal": 2200, "deficitKcal": 300, "proteinGrams": 160]

    init(scenario: Data) throws {
        let root = try JSONSerialization.jsonObject(with: scenario) as! [String: Any]
        let interactions = root["interactions"] as! [[String: Any]]
        let response = interactions[0]["response"] as! [String: Any]
        settings = try JSONSerialization.data(withJSONObject: response["body"]!)
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.url.path == "/api/settings" {
            if request.method == .patch, let data = request.body,
               let patch = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let area = patch["area"] as? String, let key = patch["key"] as? String {
                var root = try JSONSerialization.jsonObject(with: settings) as! [String: Any]
                var values = root["settings"] as! [String: Any]
                var section = values[area] as? [String: Any] ?? [:]
                section[key] = patch["value"]
                values[area] = section
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

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse { throw HTTPTransportFailure.network }
}
