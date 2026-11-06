import Foundation
import JarvisCore
import SwiftUI

#Preview("Sundhed · Dansk") {
    NavigationStack {
        JarvisHealthArea(
            client: JarvisHealthPreview.makeClient(),
            language: .da,
            observeRefreshEvents: false,
            now: JarvisHealthPreview.now
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.da.locale)
}

#Preview("Health · English") {
    NavigationStack {
        JarvisHealthArea(
            client: JarvisHealthPreview.makeClient(),
            language: .en,
            observeRefreshEvents: false,
            now: JarvisHealthPreview.now
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.en.locale)
}

enum JarvisHealthPreview {
    static let now = ISO8601DateFormatter().date(from: "2026-10-31T12:00:00Z")!

    static func makeClient() -> JarvisHealthClient? {
        let scenario = Data(
            """
            {
              "version": 1,
              "interactions": [
                {
                  "method": "GET",
                  "path": "/api/health/capabilities",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "module": "health",
                      "version": 5,
                      "sources": [
                        "daily.health.workouts",
                        "daily.health.workout",
                        "daily.health.heart-rate",
                        "daily.health.metrics",
                        "daily.health.metric-catalog",
                        "daily.health.sleep",
                        "daily.nutrition.days",
                        "daily.nutrition.meals",
                        "daily.sync"
                      ]
                    }
                  }
                },
                {
                  "method": "GET",
                  "path": "/api/health/training-targets",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "targets": {
                        "gymSessionsPerWeek": 3,
                        "runSessionsPerWeek": 2,
                        "dailySteps": 8000
                      }
                    }
                  }
                },
                {
                  "method": "GET",
                  "path": "/api/health/nutrition-targets",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "targets": {
                        "restingKcal": 2200,
                        "deficitKcal": 400,
                        "proteinGrams": 130
                      }
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.workouts",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "limit": 200
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.workouts",
                      "items": [{
                        "id": "synthetic-workout-1",
                        "workout_type": "Running",
                        "workout_date": "2026-10-31",
                        "start_at": "2026-10-31T07:00:00Z",
                        "duration_seconds": 1800,
                        "distance_value": 5,
                        "distance_unit": "km",
                        "active_energy_value": 310,
                        "active_energy_unit": "kcal",
                        "avg_heart_rate": 144
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "metric": "step_count",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{
                        "metric_date": "2026-10-31",
                        "metric_name": "step_count",
                        "value": 6420,
                        "unit": "count"
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.nutrition.days",
                    "startDate": "2026-10-25",
                    "endDate": "2026-10-31",
                    "limit": 400
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.nutrition.days",
                      "items": [
                        {"meal_date": "2026-10-25", "meal_count": 3, "energy_kcal": 2000, "protein_grams": 118, "carbohydrates_grams": 230, "fat_grams": 66, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-26", "meal_count": 3, "energy_kcal": 2250, "protein_grams": 131, "carbohydrates_grams": 260, "fat_grams": 74, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-27", "meal_count": 3, "energy_kcal": 1900, "protein_grams": 104, "carbohydrates_grams": 210, "fat_grams": 60, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-28", "meal_count": 3, "energy_kcal": 2100, "protein_grams": 125, "carbohydrates_grams": 240, "fat_grams": 70, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-29", "meal_count": 3, "energy_kcal": 2300, "protein_grams": 140, "carbohydrates_grams": 270, "fat_grams": 78, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-30", "meal_count": 3, "energy_kcal": 1850, "protein_grams": 99, "carbohydrates_grams": 205, "fat_grams": 58, "partial_nutrients": [], "unknown_nutrients": []},
                        {"meal_date": "2026-10-31", "meal_count": 3, "energy_kcal": 1450, "protein_grams": 92, "carbohydrates_grams": 160, "fat_grams": 48, "partial_nutrients": [], "unknown_nutrients": []}
                      ],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 7, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.nutrition.meals",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "limit": 100
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.nutrition.meals",
                      "items": [{
                        "id": "synthetic-meal-1",
                        "meal_name": "Breakfast",
                        "occurred_at": "2026-10-31T08:00:00Z",
                        "energy_kcal": 450,
                        "protein_grams": 32
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.sleep",
                    "startDate": "2026-10-25",
                    "endDate": "2026-10-31",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.sleep",
                      "items": [
                        {"sleep_date": "2026-10-25", "total_sleep_hours": 6.8, "asleep_hours": 6.8, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 3.9, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-26", "total_sleep_hours": 7.4, "asleep_hours": 7.4, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 4.5, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-27", "total_sleep_hours": 8.1, "asleep_hours": 8.1, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 5.2, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-28", "total_sleep_hours": 6.2, "asleep_hours": 6.2, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 3.3, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-29", "total_sleep_hours": 7.0, "asleep_hours": 7.0, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 4.1, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-30", "total_sleep_hours": 7.8, "asleep_hours": 7.8, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 4.9, "awake_hours": 0.4},
                        {"sleep_date": "2026-10-31", "total_sleep_hours": 7.5, "asleep_hours": 7.5, "deep_hours": 1.2, "rem_hours": 1.7, "light_hours": 4.6, "awake_hours": 0.4}
                      ],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 7, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.metric-catalog",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metric-catalog",
                      "items": [
                        {
                          "metric_name": "body_fat_percentage",
                          "units": ["%"],
                          "first_date": "2026-10-31",
                          "last_date": "2026-10-31",
                          "day_count": 1,
                          "latest_updated_at": "2026-10-31T09:00:00Z"
                        },
                        {
                          "metric_name": "body_mass",
                          "units": ["kg"],
                          "first_date": "2026-10-31",
                          "last_date": "2026-10-31",
                          "day_count": 1,
                          "latest_updated_at": "2026-10-31T09:00:00Z"
                        },
                        {
                          "metric_name": "lean_body_mass",
                          "units": ["kg"],
                          "first_date": "2026-10-31",
                          "last_date": "2026-10-31",
                          "day_count": 1,
                          "latest_updated_at": "2026-10-31T09:00:00Z"
                        }
                      ],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 3, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.sync"
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.sync",
                      "items": [{
                        "feeds": [{"processed_committed_at": "2026-10-31T09:30:00Z"}]
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "metric": "body_mass",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{
                        "metric_date": "2026-10-31",
                        "metric_name": "body_mass",
                        "avg_value": 72.4,
                        "value": 72.4,
                        "unit": "kg"
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "metric": "body_fat_percentage",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{
                        "metric_date": "2026-10-31",
                        "metric_name": "body_fat_percentage",
                        "avg_value": 18.5,
                        "value": 18.5,
                        "unit": "%"
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/health/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "metric": "lean_body_mass",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{
                        "metric_date": "2026-10-31",
                        "metric_name": "lean_body_mass",
                        "avg_value": 58.2,
                        "value": 58.2,
                        "unit": "kg"
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                }
              ]
            }
            """.utf8
        )
        do {
            let transport = try JarvisHealthPreviewTransport(scenario: scenario)
            let client = try JarvisClient(
                configuration: JarvisClientConfiguration(
                    baseURL: URL(string: "https://preview.invalid/api")!,
                    retryPolicy: RetryPolicy(maximumRetries: 0)
                ),
                transport: transport,
                tokenStore: JarvisHealthPreviewTokenStore(),
                accessTokenProvider: JarvisHealthPreviewTokenProvider()
            )
            return JarvisHealthClient(client: client)
        } catch {
            return nil
        }
    }
}

private actor JarvisHealthPreviewTokenStore: TokenStore {
    func read() async throws -> String? { "preview.session_token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct JarvisHealthPreviewTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        "preview.access_token"
    }

    func requestSignIn() async {}
}

/// Reusable synthetic reads allow period changes and concurrent lift/dashboard loads in simulator tests.
private actor JarvisHealthPreviewTransport: HTTPTransport {
    private let interactions: [[String: Any]]

    init(scenario: Data) throws {
        let root = try JSONSerialization.jsonObject(with: scenario) as? [String: Any]
        guard let interactions = root?["interactions"] as? [[String: Any]] else { throw FixtureTransportError.invalidScenario }
        self.interactions = interactions
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        try Task.checkCancellation()
        let body = try request.body.map { try JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
        let source = body?["source"] as? String
        if request.method == .post, request.url.path == "/api/health/query", source == "daily.health.lifts" {
            let items: [[String: Any]] = ["Squat", "Deadlift", "Bench press"].enumerated().map { index, name in
                ["id": "synthetic-lift-\(index)", "exerciseName": name, "weightKg": [80, 120, 60][index],
                 "reps": 5, "sets": 3, "performedAt": "2026-10-30T09:00:00Z"]
            }
            return try response(["source": source!, "items": items, "status": "available",
                                 "coverage": ["returned": items.count, "hasMore": false, "next": NSNull()]])
        }
        guard let interaction = interactions.first(where: { item in
            guard item["method"] as? String == request.method.rawValue,
                  item["path"] as? String == request.url.path else { return false }
            let expected = item["requestBody"] as? [String: Any]
            return expected?["source"] as? String == source && expected?["metric"] as? String == body?["metric"] as? String
        }), let reply = interaction["response"] as? [String: Any], var payload = reply["body"] as? [String: Any] else {
            throw FixtureTransportError.requestMismatch
        }
        if request.url.path == "/api/health/capabilities" {
            payload["sources"] = (payload["sources"] as? [String] ?? []) + ["daily.health.lifts"]
        }
        // Synthetic sparse histories exercise real date spacing and tap inspection.
        // Lean mass deliberately keeps one point to verify the single-reading chart.
        if source == "daily.health.metrics", let metric = body?["metric"] as? String,
           metric == "body_mass" || metric == "body_fat_percentage" {
            let dates = ["2026-10-08", "2026-10-18", "2026-10-25", "2026-10-31"]
            let values = metric == "body_mass" ? [73.0, 72.8, 72.6, 72.4] : [19.2, 19.0, 18.7, 18.5]
            payload["items"] = zip(dates, values).map { day, value in
                ["metric_date": day, "metric_name": metric, "value": value,
                 "unit": metric == "body_mass" ? "kg" : "%"] as [String: Any]
            }
        }
        if let start = body?["startDate"] as? String, let end = body?["endDate"] as? String,
           let items = payload["items"] as? [[String: Any]] {
            let filtered = items.filter { item in
                let raw = item["metric_date"] ?? item["workout_date"] ?? item["meal_date"] ?? item["sleep_date"]
                guard let date = raw as? String else { return true }
                return date >= start && date <= end
            }
            payload["items"] = filtered
            payload["status"] = filtered.isEmpty ? "empty" : "available"
            payload["coverage"] = ["returned": filtered.count, "hasMore": false, "next": NSNull()]
        }
        return try response(payload)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse { throw FixtureTransportError.expectedStream }

    private func response(_ body: [String: Any]) throws -> HTTPResponse {
        HTTPResponse(statusCode: 200, headers: [:], body: try JSONSerialization.data(withJSONObject: body))
    }
}
