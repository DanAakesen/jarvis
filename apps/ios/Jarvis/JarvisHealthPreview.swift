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
                  "path": "/api/daily/capabilities",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "module": "daily",
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
                  "path": "/api/daily/training-targets",
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
                  "path": "/api/daily/nutrition-targets",
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
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
                  "requestBody": {
                    "source": "daily.nutrition.days",
                    "startDate": "2026-10-31",
                    "endDate": "2026-10-31",
                    "limit": 400
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.nutrition.days",
                      "items": [{
                        "meal_date": "2026-10-31",
                        "meal_count": 3,
                        "energy_kcal": 1450,
                        "protein_grams": 92,
                        "partial_nutrients": [],
                        "unknown_nutrients": []
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
                  "requestBody": {
                    "source": "daily.health.sleep",
                    "startDate": "2026-10-30",
                    "endDate": "2026-10-31",
                    "limit": 500
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.sleep",
                      "items": [{
                        "sleep_date": "2026-10-31",
                        "total_sleep_hours": 7.5,
                        "asleep_hours": 7.2
                      }],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
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
                  "path": "/api/daily/query",
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
            let transport = try FixtureTransport(scenario: scenario)
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
