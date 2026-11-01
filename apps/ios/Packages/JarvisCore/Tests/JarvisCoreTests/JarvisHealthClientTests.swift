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
                      "version": 6,
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

        XCTAssertEqual(capabilities.version, 6)
        XCTAssertTrue(capabilities.availableSources.contains(JarvisHealthSource.metrics.rawValue))
        XCTAssertEqual(result.items.count, 2)
        XCTAssertFalse(result.coverage.hasMore)
        let acceptHeaders = await transport.acceptHeaders()
        let requests = await fixture.recordedRequests()
        let remainingInteractions = await fixture.remainingInteractions()
        XCTAssertEqual(acceptHeaders.first, "application/json;version=6")
        XCTAssertTrue(acceptHeaders.dropFirst().allSatisfy { $0 == "application/json" })
        XCTAssertEqual(
            requests.map(\.path),
            ["/api/daily/capabilities", "/api/daily/query", "/api/daily/query"]
        )
        XCTAssertEqual(remainingInteractions, 0)
    }

    func testLiftQueriesArePeriodlessAndPreserveLatestExercisePaging() throws {
        let query = try JarvisHealthQuery(source: .lifts, limit: 100, lastPerExercise: true)
        let cursor: JSONValue = .object(["exerciseKey": .string("squat")])
        let page = try query.page(after: cursor)
        let body = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(page))
        XCTAssertEqual(body, .object([
            "source": .string("daily.health.lifts"), "limit": .number(100),
            "lastPerExercise": .bool(true), "cursor": cursor,
        ]))
        XCTAssertThrowsError(try JarvisHealthQuery(source: .lifts, limit: 101))
        XCTAssertThrowsError(try JarvisHealthQuery(source: .sync, lastPerExercise: true))
        XCTAssertThrowsError(try JarvisHealthQuery(
            source: .lifts, period: JarvisHealthPeriod.make(.today)
        ))
    }

    func testLiftDraftUsesBackendValidationBounds() {
        func valid(_ name: String = "Squat", _ kg: Double = 80, _ reps: Int = 5, _ sets: Int = 3) -> Bool {
            JarvisLiftDraft(
                idempotencyKey: UUID(), exerciseName: name, weightKg: kg, reps: reps, sets: sets
            ).isValid
        }
        XCTAssertTrue(valid())
        XCTAssertTrue(valid(" Squat ", 0, 1000, 100))
        XCTAssertTrue(valid("Squat", 1000))
        XCTAssertFalse(valid(" "))
        XCTAssertFalse(valid(String(repeating: "a", count: 81)))
        XCTAssertFalse(valid("Squat\u{7f}"))
        XCTAssertFalse(valid("Squat", .nan))
        XCTAssertFalse(valid("Squat", -1))
        XCTAssertFalse(valid("Squat", 80.123))
        XCTAssertFalse(valid("Squat", 80, 0))
        XCTAssertFalse(valid("Squat", 80, 5, 101))
    }

    func testLatestExercisesUseTheSharedLiftSourceAndReturnedCursor() async throws {
        let cursor: [String: Any] = ["exerciseKey": "squat", "id": "synthetic-lift-1"]
        let interactions: [[String: Any]] = [0, 1].map { page in
            var request: [String: Any] = [
                "source": "daily.health.lifts", "limit": 1, "lastPerExercise": true,
            ]
            if page == 1 { request["cursor"] = cursor }
            return [
                "method": "POST", "path": "/api/daily/query", "requestBody": request,
                "response": ["statusCode": 200, "body": [
                    "source": "daily.health.lifts", "status": page == 0 ? "partial" : "available",
                    "items": [["exerciseName": page == 0 ? "Squat" : "Bench press", "weightKg": 80]],
                    "coverage": [
                        "returned": 1, "hasMore": page == 0,
                        "next": page == 0 ? cursor as Any : NSNull(),
                    ],
                ]],
            ]
        }
        let fixture = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: [
            "version": 1, "interactions": interactions,
        ]))
        let health = JarvisHealthClient(client: try makeClient(fixture))
        let result = try await health.queryAll(JarvisHealthQuery(
            source: .lifts, limit: 1, lastPerExercise: true
        ))
        XCTAssertEqual(result.items.count, 2)
        XCTAssertFalse(result.coverage.hasMore)
        let remaining = await fixture.remainingInteractions()
        XCTAssertEqual(remaining, 0)
    }

    func testLiftSaveRetryReusesTheSameSubmissionAndAuthenticatedRoute() async throws {
        let id = UUID(uuidString: "00000000-0000-4000-8000-000000000039")!
        let body: [String: Any] = [
            "idempotencyKey": id.uuidString, "exerciseName": "Squat",
            "weightKg": 80, "reps": 5, "sets": 3,
        ]
        let interactions: [[String: Any]] = [503, 201, 200].map { status in
            [
                "method": "POST", "path": "/api/daily/lifts", "requestBody": body,
                "response": [
                    "statusCode": status,
                    "body": ["entry": ["id": id.uuidString], "replayed": status == 200],
                ],
            ]
        }
        let fixture = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: [
            "version": 1, "interactions": interactions,
        ]))
        let transport = HealthHeaderRecordingTransport(fixture: fixture)
        let health = JarvisHealthClient(client: try makeClient(transport, maximumRetries: 1))
        let draft = JarvisLiftDraft(
            idempotencyKey: id, exerciseName: " Squat ", weightKg: 80, reps: 5, sets: 3
        )
        do {
            try await health.createLift(JarvisLiftDraft(
                idempotencyKey: id, exerciseName: "", weightKg: 80, reps: 5, sets: 3
            ))
            XCTFail("Invalid drafts must not reach the transport")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .invalidRequest)
        }
        do {
            try await health.createLift(draft)
            XCTFail("A failed write must not be reported as saved")
        } catch {}
        let afterFailure = await fixture.remainingInteractions()
        XCTAssertEqual(afterFailure, 2, "Writes must not retry automatically")
        try await health.createLift(draft)
        try await health.createLift(draft)
        let remaining = await fixture.remainingInteractions()
        XCTAssertEqual(remaining, 0)
        let authorized = await transport.allRequestsAuthorized()
        XCTAssertTrue(authorized)
    }

    private func makeClient(_ transport: any HTTPTransport, maximumRetries: Int = 0) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: maximumRetries)
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
    private var authorized = true

    init(fixture: FixtureTransport) {
        self.fixture = fixture
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        authorized = authorized && request.headers["Authorization"] != nil
        if let accept = request.headers["Accept"] { accepted.append(accept) }
        return try await fixture.send(request)
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        if let accept = request.headers["Accept"] { accepted.append(accept) }
        return try await fixture.stream(request)
    }

    func acceptHeaders() -> [String] { accepted }
    func allRequestsAuthorized() -> Bool { authorized }
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
