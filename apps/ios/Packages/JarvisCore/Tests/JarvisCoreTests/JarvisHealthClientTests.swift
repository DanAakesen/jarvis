import Foundation
import XCTest
@testable import JarvisCore

final class JarvisHealthClientTests: XCTestCase {
    func testHealthLocalizationIsCompleteInDanishAndEnglish() {
        for key in JarvisHealthLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisHealthLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisHealthLocalization.string(key, language: .en), key.rawValue)
        }
        XCTAssertEqual(JarvisHealthLocalization.string(.dashboard, language: .da), "Overblik")
        XCTAssertEqual(JarvisHealthLocalization.string(.trackWorkout, language: .en), "Track workout")
        XCTAssertNotEqual(
            JarvisHealthLocalization.formattedDate("2026-10-31", language: .da),
            JarvisHealthLocalization.formattedDate("2026-10-31", language: .en)
        )
        let danishTime = JarvisHealthLocalization.formattedDateTime("2026-10-31T08:00:00Z", language: .da)
        let englishTime = JarvisHealthLocalization.formattedDateTime("2026-10-31T08:00:00Z", language: .en)
        XCTAssertFalse(danishTime.contains("T"))
        XCTAssertNotEqual(danishTime, englishTime)
    }

    func testPeriodPresetsUseCopenhagenDatesAndInclusiveDayCounts() throws {
        let instant = ISO8601DateFormatter().date(from: "2026-10-30T23:30:00Z")!

        let today = JarvisHealthPeriod.make(.today, now: instant)
        let yesterday = JarvisHealthPeriod.make(.yesterday, now: instant)
        let week = JarvisHealthPeriod.make(.sevenDays, now: instant)

        XCTAssertEqual(today.startDate, "2026-10-31")
        XCTAssertEqual(yesterday.startDate, "2026-10-30")
        XCTAssertEqual(week.startDate, "2026-10-25")
        XCTAssertEqual(week.endDate, "2026-10-31")
        XCTAssertEqual(week.dayCount, 7)
        XCTAssertNil(JarvisHealthPeriod(startDate: "2026-02-30", endDate: "2026-03-01"))
        XCTAssertNil(JarvisHealthPeriod(startDate: "2026-10-31", endDate: "2026-10-30"))
    }

    func testRingProgressAndNutritionBalanceDoNotInventTargets() {
        XCTAssertEqual(JarvisHealthLogic.ringProgress(value: 4, target: 8), 0.5)
        XCTAssertEqual(JarvisHealthLogic.ringProgress(value: 12, target: 8), 1)
        XCTAssertEqual(JarvisHealthLogic.ringProgress(value: 0, target: 0), 0)
        XCTAssertNil(JarvisHealthLogic.ringProgress(value: 2, target: nil))
        XCTAssertEqual(JarvisHealthLogic.scaledWeeklyTarget(3, days: 30), 90.0 / 7.0)
        XCTAssertEqual(
            JarvisHealthLogic.calorieBalance(eaten: 1_200, restingKcal: 2_000, deficitKcal: 300)?.amount,
            500
        )
        XCTAssertNil(JarvisHealthLogic.calorieBalance(eaten: 1_200, restingKcal: nil, deficitKcal: 300))
    }

    func testTargetReadsReuseTheExistingDailyRoutes() async throws {
        let fixture = try FixtureTransport(scenario: Data(
            """
            {
              "version": 1,
              "interactions": [
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
                }
              ]
            }
            """.utf8
        ))
        let client = JarvisHealthClient(client: try makeClient(fixture))

        let training = try await client.trainingTargets()
        let nutrition = try await client.nutritionTargets()

        XCTAssertEqual(training.targets.gymSessionsPerWeek, 3)
        XCTAssertEqual(training.targets.runSessionsPerWeek, 2)
        XCTAssertEqual(training.targets.dailySteps, 8000)
        XCTAssertEqual(nutrition.targets.restingKcal, 2200)
        XCTAssertEqual(nutrition.targets.deficitKcal, 400)
        XCTAssertEqual(nutrition.targets.proteinGrams, 130)
        let requests = await fixture.recordedRequests()
        XCTAssertEqual(requests.map(\.path), [
            "/api/daily/training-targets",
            "/api/daily/nutrition-targets",
        ])
        let remainingInteractions = await fixture.remainingInteractions()
        XCTAssertEqual(remainingInteractions, 0)
    }

    func testWorkoutAndBodyMetricClassificationMatchesDailyNames() {
        XCTAssertEqual(JarvisHealthLogic.workoutKind("HKWorkoutActivityType.traditionalStrengthTraining"), .gym)
        XCTAssertEqual(JarvisHealthLogic.workoutKind("Running"), .run)
        XCTAssertEqual(JarvisHealthLogic.workoutKind("Walking"), .other)
        XCTAssertTrue(JarvisHealthLogic.bodyMetricName("body_mass", matching: .weight))
        XCTAssertTrue(JarvisHealthLogic.bodyMetricName("body_fat_percentage", matching: .fatPercent))
        XCTAssertFalse(JarvisHealthLogic.bodyMetricName("height", matching: .weight))
    }

    func testCapabilitiesAndPagedQueriesReuseAuthenticatedDailyRoutes() async throws {
        let fixture = try FixtureTransport(scenario: Data(
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
                      "sources": ["daily.health.metrics"]
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/daily/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-30",
                    "endDate": "2026-10-31",
                    "metric": "step_count",
                    "limit": 1
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{"metric_date": "2026-10-30", "metric_name": "step_count", "value": 5000}],
                      "status": "partial",
                      "freshness": null,
                      "coverage": {
                        "returned": 1,
                        "hasMore": true,
                        "next": {"date": "2026-10-30", "key": "step_count"}
                      }
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/daily/query",
                  "requestBody": {
                    "source": "daily.health.metrics",
                    "startDate": "2026-10-30",
                    "endDate": "2026-10-31",
                    "metric": "step_count",
                    "limit": 1,
                    "cursor": {"date": "2026-10-30", "key": "step_count"}
                  },
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "source": "daily.health.metrics",
                      "items": [{"metric_date": "2026-10-31", "metric_name": "step_count", "value": 7000}],
                      "status": "available",
                      "freshness": null,
                      "coverage": {"returned": 1, "hasMore": false, "next": null}
                    }
                  }
                }
              ]
            }
            """.utf8
        ))
        let transport = HealthHeaderRecordingTransport(fixture: fixture)
        let client = try makeClient(transport)
        let health = JarvisHealthClient(client: client)

        let capabilities = try await health.capabilities()
        let period = try XCTUnwrap(JarvisHealthPeriod(startDate: "2026-10-30", endDate: "2026-10-31"))
        let query = try JarvisHealthQuery(source: .metrics, period: period, metric: "step_count", limit: 1)
        let result = try await health.queryAll(query)

        XCTAssertEqual(capabilities.version, 5)
        XCTAssertTrue(capabilities.availableSources.contains(JarvisHealthSource.metrics.rawValue))
        XCTAssertEqual(result.items.count, 2)
        XCTAssertFalse(result.coverage.hasMore)
        let acceptHeaders = await transport.acceptHeaders()
        let requests = await fixture.recordedRequests()
        let remainingInteractions = await fixture.remainingInteractions()
        XCTAssertEqual(acceptHeaders.first, "application/json;version=5")
        XCTAssertTrue(acceptHeaders.dropFirst().allSatisfy { $0 == "application/json" })
        XCTAssertEqual(
            requests.map(\.path),
            ["/api/daily/capabilities", "/api/daily/query", "/api/daily/query"]
        )
        XCTAssertEqual(remainingInteractions, 0)
    }

    private func makeClient(_ transport: any HTTPTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: HealthFixtureTokenStore(),
            accessTokenProvider: HealthFixtureTokenProvider()
        )
    }
}

private actor HealthHeaderRecordingTransport: HTTPTransport {
    private let fixture: FixtureTransport
    private var accepted: [String] = []

    init(fixture: FixtureTransport) {
        self.fixture = fixture
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if let accept = request.headers["Accept"] { accepted.append(accept) }
        return try await fixture.send(request)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        if let accept = request.headers["Accept"] { accepted.append(accept) }
        return try await fixture.stream(request)
    }

    func acceptHeaders() -> [String] { accepted }
}

private actor HealthFixtureTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct HealthFixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.access.token" }
    func requestSignIn() async {}
}
