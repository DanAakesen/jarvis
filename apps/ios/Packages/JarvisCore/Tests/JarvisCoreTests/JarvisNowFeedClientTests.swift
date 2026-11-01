import Foundation
import XCTest
@testable import JarvisCore

final class JarvisNowFeedClientTests: XCTestCase {
    func testLoadsFullCalendarReviewAlongsideTenExistingConfirmations() async throws {
        let summary = String(repeating: "x", count: 40_000)
        let confirmations: [[String: String]] = (0..<11).map { index in
            let id = String(repeating: index == 10 ? "Z" : String(index), count: 43)
            return ["id": id, "actionKind": index == 10 ? "calendar_change" : "merge",
                    "summary": index == 10 ? summary : "Existing request",
                    "expiresAt": "2026-10-30T00:05:00Z"]
        }
        let scenario = try JSONSerialization.data(withJSONObject: [
            "version": 1, "interactions": [[
                "method": "GET", "path": "/api/now", "response": [
                    "statusCode": 200, "body": [
                        "running": [], "items": [], "updatedAt": "2026-10-30T00:00:02Z",
                        "awayMode": false, "confirmations": confirmations,
                    ],
                ],
            ]],
        ])
        let transport = try FixtureTransport(scenario: scenario)
        let feed = try await JarvisNowFeedClient(client: makeClient(transport: transport)).load()
        XCTAssertEqual(feed.confirmations.count, 11)
        XCTAssertEqual(feed.confirmations.last?.summary, summary)
    }

    func testLoadsFeedDismissesActivityAndResolvesConfirmation() async throws {
        let scenario = Data(
            """
            {
              "version": 1,
              "interactions": [
                {
                  "method": "GET",
                  "path": "/api/now",
                  "response": {
                    "statusCode": 200,
                    "body": {
                      "running": [{"id":"7","title":"Synthetic task","project":"fixture","agent":"copilot","activity":"Working","startedAt":"2026-10-30T00:00:00Z"}],
                      "items": [{"id":"8","category":"attention","title":"Synthetic activity","link":"task:7","at":"2026-10-30T00:00:01Z"}],
                      "updatedAt":"2026-10-30T00:00:02Z",
                      "awayMode":false,
                      "confirmations":[{"id":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","actionKind":"other","summary":"Synthetic confirmation","expiresAt":"2026-10-30T00:05:00Z"}]
                    }
                  }
                },
                {
                  "method": "POST",
                  "path": "/api/now/activity/8/dismiss",
                  "response": {"statusCode":204}
                },
                {
                  "method": "POST",
                  "path": "/api/now/confirmations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  "requestBody":{"decision":"approve"},
                  "response":{"statusCode":204}
                }
              ]
            }
            """.utf8
        )
        let transport = try FixtureTransport(scenario: scenario)
        let client = try makeClient(transport: transport)
        let now = JarvisNowFeedClient(client: client)

        let feed = try await now.load()
        try await now.dismissActivity(id: "8")
        try await now.resolveConfirmation(
            id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            decision: .approve
        )

        XCTAssertEqual(feed.running.count, 1)
        XCTAssertEqual(feed.items.first?.category, .attention)
        XCTAssertFalse(feed.awayMode)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(
            requests.map(\.path),
            [
                "/api/now",
                "/api/now/activity/8/dismiss",
                "/api/now/confirmations/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            ]
        )
    }

    func testRejectsInvalidActivityIDBeforeRequest() async throws {
        let transport = try FixtureTransport(scenario: Data(#"{"version":1,"interactions":[{"method":"POST","path":"/unused","response":{"statusCode":204}}]}"#.utf8))
        let now = JarvisNowFeedClient(client: try makeClient(transport: transport))

        do {
            try await now.dismissActivity(id: "0")
            XCTFail("Expected invalid activity id")
        } catch {
            XCTAssertEqual(error as? JarvisNowFeedClientError, .invalidActivityID)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testBackgroundTasksRestoreRealFinalStatesAndRegisterPushToken() async throws {
        let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        let token = String(repeating: "a", count: 64)
        let scenario = Data("""
        {"version":1,"interactions":[
          {"method":"GET","path":"/api/jobs","response":{"statusCode":200,"body":{"jobs":[
            {"jobId":"\(id)","title":"Synthetic research","status":"done","detail":"Saved","startedAt":"2026-10-30T00:00:00Z","updatedAt":"2026-10-30T00:01:00Z"},
            {"jobId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","title":"Synthetic failure","status":"failed","startedAt":"2026-10-30T00:00:00Z","updatedAt":"2026-10-30T00:01:00Z"}
          ],"dismissedJobIds":[]}}},
          {"method":"POST","path":"/api/ios/task-activities","requestBody":{"taskID":"\(id)","activityID":"fixture-activity","pushToken":"\(token)","language":"da"},"response":{"statusCode":204}}
        ]}
        """.utf8)
        let transport = try FixtureTransport(scenario: scenario)
        let now = JarvisNowFeedClient(client: try makeClient(transport: transport))
        let tasks = try await now.backgroundTasks()
        XCTAssertEqual(tasks.map(\.status), [.done, .failed])
        XCTAssertEqual(tasks.first?.detail, "Saved")
        XCTAssertEqual(tasks.first?.status.localizationKey, .done)
        XCTAssertEqual(tasks.last?.status.localizationKey, .failed)
        try await now.registerTaskActivity(taskID: id, activityID: "fixture-activity", pushToken: token, language: .da)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/jobs", "/api/ios/task-activities"])
    }

    func testInvalidPushRegistrationNeverReachesTransport() async throws {
        let transport = try FixtureTransport(scenario: Data(#"{"version":1,"interactions":[{"method":"POST","path":"/unused","response":{"statusCode":204}}]}"#.utf8))
        let now = JarvisNowFeedClient(client: try makeClient(transport: transport))
        for (id, token) in [
            ("../1", String(repeating: "a", count: 64)),
            ("1", "not-a-token"),
            ("1", String(repeating: "a", count: 65)),
        ] {
            do {
                try await now.registerTaskActivity(taskID: id, activityID: "fixture-activity", pushToken: token, language: .en)
                XCTFail("Expected invalid registration")
            } catch {
                XCTAssertEqual(error as? JarvisNowFeedClientError, .invalidResponse)
            }
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testFactoryActivityPhasesDistinguishWaitingFailureAndCompletion() {
        XCTAssertEqual(FactoryTaskState.running.activityPhase(latestSessionEndReason: nil), "running")
        XCTAssertEqual(FactoryTaskState.pauseRequested.activityPhase(latestSessionEndReason: nil), "running")
        for state in [FactoryTaskState.ready, .paused, .needsAttention] {
            XCTAssertEqual(state.activityPhase(latestSessionEndReason: nil), "waiting")
        }
        XCTAssertEqual(FactoryTaskState.needsAttention.activityPhase(latestSessionEndReason: .crashed), "failed")
        XCTAssertEqual(FactoryTaskState.done.activityPhase(latestSessionEndReason: .done), "done")
        XCTAssertEqual(FactoryTaskState.cancelled.activityPhase(latestSessionEndReason: .cancelled), "cancelled")
        XCTAssertEqual(BackgroundTaskRecord.Status.running.localizationKey, .running)
        XCTAssertEqual(BackgroundTaskRecord.Status.cancelled.localizationKey, .cancelled)
    }

    func testSuspensionDetachesOnlyTransportAndResumeReadsServerTruth() throws {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        let source = try String(
            contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/JarvisChatModel.swift"),
            encoding: .utf8
        )
        let suspend = try XCTUnwrap(source.components(separatedBy: "func suspendObservation() {").last?
            .components(separatedBy: "func watchActivity()").first)
        XCTAssertTrue(suspend.contains("sendTask?.cancel()"))
        XCTAssertTrue(suspend.contains("guard isSending else { return }"))
        XCTAssertFalse(suspend.contains("client.cancelTurn("))
        let resume = try XCTUnwrap(source.components(separatedBy: "func resume() async {").last?
            .components(separatedBy: "func suspendObservation()").first)
        XCTAssertTrue(resume.contains("await sendTask?.value"))
        XCTAssertTrue(resume.contains("await refreshHistory()"))
        XCTAssertTrue(resume.contains("await refreshActivity()"))
        XCTAssertTrue(resume.contains("await reattachActiveTurnIfNeeded()"))
        let activity = try String(
            contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/JarvisFactoryLiveActivityController.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(activity.contains("pushType: .token"))
        XCTAssertTrue(activity.contains("activity.pushTokenUpdates"))
        XCTAssertTrue(activity.contains("dismissalPolicy: .after"))
        XCTAssertTrue(activity.contains("UIApplication.openSettingsURLString"))
        XCTAssertTrue(activity.contains("\nstruct JarvisTaskActivityNotice: View"))
        XCTAssertFalse(activity.contains("await activity.end(nil, dismissalPolicy: .immediate)\n        }"))
    }

    func testBackgroundTaskSheetUsesItsObservedAppLanguage() throws {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        let source = try String(
            contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/JarvisActivitySheet.swift"),
            encoding: .utf8
        )
        XCTAssertTrue(source.contains("@AppStorage(JarvisAppLanguage.preferenceKey)"))
        let section = try XCTUnwrap(source.components(separatedBy: "private var backgroundTaskSection:").last?
            .components(separatedBy: "private func confirmationSection(").first)
        XCTAssertTrue(section.contains("let language = appLanguage"))
        XCTAssertFalse(section.contains("JarvisAppLanguage.current"))
    }

    private func makeClient(transport: any HTTPTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://fixture.invalid/api")!),
            transport: transport,
            tokenStore: NowFeedTokenStore(),
            accessTokenProvider: NowFeedTokenProvider()
        )
    }
}

private actor NowFeedTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct NowFeedTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
