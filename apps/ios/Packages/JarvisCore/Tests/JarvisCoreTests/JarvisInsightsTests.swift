import Foundation
import XCTest
@testable import JarvisCore

final class JarvisInsightsLocalizationTests: XCTestCase {
    func testEveryInsightsStringHasDanishAndEnglishCopy() {
        for key in JarvisInsightsLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisInsightsLocalization.string(key, language: .da), key.rawValue, key.rawValue)
            XCTAssertNotEqual(JarvisInsightsLocalization.string(key, language: .en), key.rawValue, key.rawValue)
        }
        XCTAssertEqual(JarvisInsightsLocalization.string(.proactiveCheckNow, language: .da), "Tjek nu")
        XCTAssertEqual(JarvisInsightsLocalization.string(.proactiveCheckNow, language: .en), "Check now")
    }

    func testFormattedStringsFillTheirArguments() {
        XCTAssertEqual(JarvisInsightsLocalization.format(.minutesAgo, language: .en, 5), "5 min ago")
        XCTAssertEqual(JarvisInsightsLocalization.format(.showMore, language: .en, 3), "Show 3 more")
        XCTAssertEqual(JarvisInsightsLocalization.format(.showMore, language: .da, 3), "Vis 3 mere")
        XCTAssertEqual(
            JarvisInsightsLocalization.format(.usageTruncated, language: .en, 1000, "1482"),
            "Latest 1,000 of 1482"
        )
    }
}

final class JarvisUsageSummaryTests: XCTestCase {
    private func entry(
        task: String? = "1", project: String? = "Jarvis", projectId: String? = "10", agent: String = "codex",
        source: String = "codex", metric: String = "turns", quantity: Double = 1, cost: Double?,
        at: String, estimated: Bool = false
    ) -> JarvisUsageEntry {
        JarvisUsageEntry(
            taskId: task, taskTitle: task.map { "Task \($0)" }, projectId: projectId, projectName: project,
            agent: agent, source: source, metric: metric, quantity: quantity, costDkk: cost, at: at,
            estimated: estimated
        )
    }

    private func report(_ entries: [JarvisUsageEntry], period: String = "7d", truncated: Bool = false) -> JarvisUsageReport {
        JarvisUsageReport(
            period: period, from: nil, to: "2026-11-02T10:00:00Z", entries: entries,
            totalEntries: String(entries.count), truncated: truncated
        )
    }

    func testUsagePhraseUsesCompactCostOrAGenericLine() {
        let costed = JarvisUsageSummary(
            report: report([entry(cost: 1500, at: "2026-11-01T09:00:00Z")]), period: .sevenDays
        )
        XCTAssertEqual(JarvisUsagePagePhrase.make(costed, language: .en).plainText, "Dan, your usage is 1.5k DKK.")
        XCTAssertEqual(JarvisUsagePagePhrase.make(costed, language: .da).plainText, "Dan, dit forbrug er 1,5k kr.")
        let free = JarvisUsageSummary(report: report([entry(cost: nil, at: "2026-11-01T09:00:00Z")]), period: .sevenDays)
        XCTAssertEqual(JarvisUsagePagePhrase.make(free, language: .en).plainText, "Dan, here is your usage.")
    }

    func testRangesMapToBucketKindsAndCounts() {
        XCTAssertEqual(JarvisUsagePeriod.default, .thirtyDays)
        XCTAssertEqual(JarvisUsagePeriod.allCases.map(\.rawValue), ["7d", "30d", "90d", "all"])
        let data = report([entry(cost: 1, at: "2026-11-01T09:00:00Z")])
        XCTAssertEqual(JarvisUsageSummary(report: data, period: .sevenDays).buckets.count, 7)
        XCTAssertEqual(JarvisUsageSummary(report: data, period: .thirtyDays).buckets.count, 30)
        let weeks = JarvisUsageSummary(report: data, period: .ninetyDays).buckets
        XCTAssertEqual(weeks.count, 14)
        XCTAssertTrue(weeks.allSatisfy { $0.kind == .week })
        let months = JarvisUsageSummary(report: data, period: .all).buckets
        XCTAssertEqual(months.map(\.startKey), ["2026-11-01"])
    }

    func testDailyBucketsUseDanishDaysAndKeepEmptyDays() {
        // 23:30 UTC on 1 November is 00:30 on 2 November in Denmark.
        let data = report([
            entry(cost: 2, at: "2026-11-01T23:30:00Z"),
            entry(cost: 3, at: "2026-11-02T08:00:00Z"),
            entry(cost: 4, at: "2026-10-30T12:00:00Z"),
        ])
        let buckets = JarvisUsageSummary(report: data, period: .sevenDays).buckets
        XCTAssertEqual(buckets.map(\.startKey).last, "2026-11-02")
        XCTAssertEqual(buckets.last?.value, 5)
        XCTAssertEqual(buckets.first { $0.startKey == "2026-10-30" }?.value, 4)
        XCTAssertEqual(buckets.first { $0.startKey == "2026-10-31" }?.value, 0)
    }

    func testWeeklyBucketsStartOnMondayAndCoverSevenDays() {
        let data = report([entry(cost: 1, at: "2026-11-02T08:00:00Z")], period: "90d")
        let weeks = JarvisUsageSummary(report: data, period: .ninetyDays).buckets
        XCTAssertEqual(weeks.last?.startKey, "2026-11-02")
        XCTAssertEqual(weeks.last?.endKey, "2026-11-08")
        XCTAssertEqual(weeks.last?.value, 1)
        XCTAssertEqual(weeks[weeks.count - 2].endKey, "2026-11-01")
    }

    func testRollingRangeKeepsTheFirstPartialDayAndWeek() {
        for (period, first) in [(JarvisUsagePeriod.sevenDays, "2026-10-26T10:00:00Z"), (.ninetyDays, "2026-08-04T10:00:00Z")] {
            let data = JarvisUsageReport(period: period.rawValue, from: first, to: "2026-11-02T10:00:00Z",
                entries: [entry(cost: 12, at: first), entry(cost: 3, at: "2026-11-02T08:00:00Z")], totalEntries: "2")
            let summary = JarvisUsageSummary(report: data, period: period)
            XCTAssertEqual(summary.buckets.reduce(0) { $0 + $1.value }, summary.totalValue)
            XCTAssertEqual(summary.buckets.first?.value, 12)
        }
    }

    func testLongAllTimeChartRetainsOldAndRecentCostsWithinTheBucketCap() {
        let summary = JarvisUsageSummary(report: report([
            entry(cost: 10, at: "2010-01-01T12:00:00Z"), entry(cost: 4, at: "2026-11-02T08:00:00Z")
        ], period: "all"), period: .all)
        XCTAssertEqual(summary.buckets.count, JarvisUsageSummary.maximumBuckets)
        XCTAssertEqual(summary.buckets.first?.startKey, "2010-01-01")
        XCTAssertEqual(summary.buckets.last?.startKey, "2026-11-01")
        XCTAssertEqual(summary.buckets.reduce(0) { $0 + $1.value }, 14)
    }

    func testCostIsTheMeasureWhenAnyCostExists() {
        let data = report([
            entry(agent: "codex", cost: 6, at: "2026-11-02T08:00:00Z", estimated: true),
            entry(task: "2", agent: "copilot", cost: nil, at: "2026-11-02T08:00:00Z"),
            entry(task: "3", agent: "jarvis", cost: 2, at: "2026-11-02T08:00:00Z"),
        ])
        let summary = JarvisUsageSummary(report: data, period: .sevenDays)
        XCTAssertTrue(summary.usesCost)
        XCTAssertTrue(summary.hasEstimates)
        XCTAssertEqual(summary.totalValue, 8)
        let slices = summary.slices(by: .agent)
        XCTAssertEqual(slices.map(\.id), ["codex", "jarvis"])
        XCTAssertEqual(slices.map(\.share), [75, 25])
    }

    func testRecordsAreCountedWhenNoCostIsReported() {
        let data = report([
            entry(agent: "codex", cost: nil, at: "2026-11-02T08:00:00Z"),
            entry(task: "2", agent: "codex", cost: nil, at: "2026-11-02T09:00:00Z"),
            entry(task: "3", agent: "copilot", cost: nil, at: "2026-11-02T09:00:00Z"),
        ])
        let summary = JarvisUsageSummary(report: data, period: .sevenDays)
        XCTAssertFalse(summary.usesCost)
        XCTAssertFalse(summary.hasEstimates)
        XCTAssertEqual(summary.totalValue, 3)
        XCTAssertEqual(summary.slices(by: .agent).map(\.value), [2, 1])
    }

    func testSharesAddUpToOneHundred() {
        XCTAssertEqual(JarvisUsageSummary.shares([1, 1, 1]), [34, 33, 33])
        XCTAssertEqual(JarvisUsageSummary.shares([50, 30, 20]), [50, 30, 20])
        XCTAssertEqual(JarvisUsageSummary.shares([2, 1]).reduce(0, +), 100)
        XCTAssertEqual(JarvisUsageSummary.shares([0, 0]), [0, 0])
        XCTAssertEqual(JarvisUsageSummary.shares([]), [])
    }

    func testProjectGroupingNamesProjectsAndKeepsUnassignedActivity() {
        let data = report([
            entry(project: "Jarvis", projectId: "10", cost: 3, at: "2026-11-02T08:00:00Z"),
            entry(task: nil, project: nil, projectId: nil, source: "voice", cost: 1, at: "2026-11-02T08:00:00Z"),
        ])
        let slices = JarvisUsageSummary(report: data, period: .sevenDays).slices(by: .project)
        XCTAssertEqual(slices.map(\.id), ["10", "no-project"])
        XCTAssertEqual(slices.map(\.name), ["Jarvis", nil])
    }

    func testTopTasksAreRankedAndLimitedToSix() {
        let entries = (1...8).map { entry(task: String($0), cost: Double($0), at: "2026-11-02T08:00:00Z") }
        let ranks = JarvisUsageSummary(report: report(entries), period: .sevenDays).topTasks()
        XCTAssertEqual(ranks.count, 6)
        XCTAssertEqual(ranks.first?.taskId, "8")
        XCTAssertEqual(ranks.last?.taskId, "3")
    }

    func testTotalsFollowTheSelectedBar() {
        let data = report([
            entry(source: "sandbox", metric: "minutes", quantity: 12, cost: 1, at: "2026-11-02T08:00:00Z"),
            entry(task: "2", metric: "input_tokens", quantity: 1000, cost: 1, at: "2026-11-02T08:00:00Z"),
            entry(task: "3", metric: "output_tokens", quantity: 500, cost: 1, at: "2026-11-01T08:00:00Z"),
            entry(task: "4", metric: "premium_requests", quantity: 3, cost: 1, at: "2026-11-01T08:00:00Z"),
        ])
        let summary = JarvisUsageSummary(report: data, period: .sevenDays)
        let all = summary.totals()
        XCTAssertEqual(all.sandboxMinutes, 12)
        XCTAssertEqual(all.tokens, 1500)
        XCTAssertEqual(all.premiumRequests, 3)
        let today = summary.buckets.last
        XCTAssertEqual(summary.totals(in: today).tokens, 1000)
        XCTAssertEqual(summary.value(in: today), 2)
        XCTAssertEqual(summary.value(), 4)
    }

    func testToolCallsAndResearchCounts() {
        let data = JarvisUsageReport(
            period: "30d", from: nil, to: "2026-11-02T10:00:00Z",
            codexToolCallsToday: [JarvisUsageToolCount(tool: "web_research", count: "4")],
            entries: [], totalEntries: "0",
            dailyToolUsage: JarvisUsageDailyTools(date: "2026-11-02", tools: [
                JarvisUsageToolCount(tool: "a", count: "1"), JarvisUsageToolCount(tool: "b", count: "5"),
                JarvisUsageToolCount(tool: "c", count: "0"),
            ])
        )
        let summary = JarvisUsageSummary(report: data, period: .thirtyDays)
        XCTAssertTrue(summary.isEmpty)
        XCTAssertEqual(summary.toolCalls.map(\.tool), ["b", "a"])
        XCTAssertEqual(summary.codexResearchCalls, 4)
    }

    func testTruncatedReportIsFlagged() {
        let data = report([entry(cost: 1, at: "2026-11-02T08:00:00Z")], truncated: true)
        XCTAssertTrue(JarvisUsageSummary(report: data, period: .sevenDays).truncated)
    }

    func testReportValidationRejectsUnknownValues() {
        XCTAssertTrue(report([entry(cost: 1, at: "2026-11-02T08:00:00Z")]).isValid)
        XCTAssertFalse(report([entry(agent: "other", cost: 1, at: "2026-11-02T08:00:00Z")]).isValid)
        XCTAssertFalse(report([entry(quantity: -1, cost: 1, at: "2026-11-02T08:00:00Z")]).isValid)
        XCTAssertFalse(report([entry(cost: 1, at: "yesterday")]).isValid)
    }

    func testClientSendsPeriodAndDecodesReport() async throws {
        let transport = try FixtureTransport(scenario: Data("""
        {"version": 1, "interactions": [{
          "method": "GET", "path": "/api/usage", "query": {"period": "7d"},
          "response": {"statusCode": 200, "body": {
            "period": "7d", "from": "2026-10-26T00:00:00Z", "to": "2026-11-02T10:00:00Z",
            "codexToolCallsToday": null,
            "entries": [{"taskId": "5", "taskTitle": "Task", "projectId": null, "projectName": null,
              "agent": "codex", "source": "codex", "metric": "turns", "quantity": 2, "costDkk": 1.5,
              "at": "2026-11-02T08:00:00.000Z", "estimated": true}],
            "totalEntries": "1", "truncated": false,
            "dailyToolUsage": {"date": "2026-11-02", "tools": []}
          }}
        }]}
        """.utf8))
        let usage = JarvisUsageClient(client: try insightsClient(transport))
        let report = try await usage.report(period: .sevenDays)
        XCTAssertEqual(report.entries.count, 1)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/usage"])
        XCTAssertEqual(requests.first?.query, ["period": "7d"])
    }

    func testCurrentBackendContractDecodesWithoutLegacyDailyTools() async throws {
        // Shape emitted by registerUsageRoutes, including distinct period and Health-only counts.
        let payload = """
        {"period":"30d","from":"2026-10-03T00:00:00Z","to":"2026-11-02T10:00:00Z",
         "entries":[],"totalEntries":"0","truncated":false,
         "healthToolUsage":{"date":"2026-11-02","tools":[{"tool":"health_read","count":"19"}]},
         "healthCostTotals":[],"monthlyCostTotals":[],"roleCoverage":[],
         "toolCalls":[{"tool":"web_research","count":"7","costStatus":"unverified"}],
         "codexToolCallsToday":[{"tool":"web_research","count":"2"}]}
        """
        let transport = try FixtureTransport(scenario: Data("""
        {"version":1,"interactions":[{"method":"GET","path":"/api/usage","query":{"period":"30d"},
        "response":{"statusCode":200,"headers":{"ETag":"usage-v2"},"body":\(payload)}}]}
        """.utf8))
        let client = JarvisUsageClient(client: try insightsClient(transport))
        guard case .modified(let report, let validator) = try await client.fetchReport(period: .thirtyDays, validator: nil) else {
            return XCTFail("Expected current backend report")
        }
        XCTAssertEqual(validator, "usage-v2")
        XCTAssertNil(report.dailyToolUsage)
        let summary = JarvisUsageSummary(report: report, period: .thirtyDays)
        XCTAssertEqual(summary.toolCalls, [JarvisUsageToolCount(tool: "web_research", count: "7")])
        XCTAssertFalse(summary.toolCallsAreDaily)
        XCTAssertEqual(summary.codexResearchCalls, 2)
        let cached = try JSONDecoder().decode(JarvisUsageReport.self, from: JSONEncoder().encode(report))
        XCTAssertEqual(cached, report)
    }

    func testLegacyToolCountsStayDailyAndMissingCountsStayUnknown() throws {
        let legacy = JarvisUsageReport(period: "7d", from: nil, to: "2026-11-02T10:00:00Z",
            entries: [], totalEntries: "0", dailyToolUsage: JarvisUsageDailyTools(date: "2026-11-02",
                tools: [JarvisUsageToolCount(tool: "calendar", count: "4")]))
        let summary = JarvisUsageSummary(report: legacy, period: .sevenDays)
        XCTAssertTrue(summary.toolCallsAreDaily)
        XCTAssertTrue(summary.toolCallsAvailable)
        XCTAssertEqual(summary.toolCalls.first?.count, "4")
        let noCounts = report([])
        XCTAssertTrue(noCounts.isValid)
        XCTAssertFalse(JarvisUsageSummary(report: noCounts, period: .sevenDays).toolCallsAvailable)
        let negative = JarvisUsageReport(period: "7d", from: nil, to: "2026-11-02T10:00:00Z",
            entries: [], totalEntries: "0", toolCalls: [JarvisUsageToolCount(tool: "web_research", count: "-1")])
        XCTAssertFalse(negative.isValid)
    }

    func testClientRejectsAReportForAnotherPeriod() async throws {
        let transport = try FixtureTransport(scenario: Data("""
        {"version": 1, "interactions": [{
          "method": "GET", "path": "/api/usage", "query": {"period": "7d"},
          "response": {"statusCode": 200, "body": {
            "period": "30d", "from": null, "to": "2026-11-02T10:00:00Z", "codexToolCallsToday": null,
            "entries": [], "totalEntries": "0", "truncated": false,
            "dailyToolUsage": {"date": "2026-11-02", "tools": []}
          }}
        }]}
        """.utf8))
        let usage = JarvisUsageClient(client: try insightsClient(transport))
        do {
            _ = try await usage.report(period: .sevenDays)
            XCTFail("Expected an invalid response")
        } catch {
            XCTAssertEqual(error as? JarvisInsightsError, .invalidResponse)
        }
    }
}

final class JarvisStatusLogicTests: XCTestCase {
    private func entry(_ id: JarvisStatusCheckID, _ status: JarvisStatusValue, details: [String: JSONValue]? = nil) -> JarvisStatusEntry {
        JarvisStatusEntry(id: id.rawValue, status: status, checkedAt: "2026-11-02T10:00:00Z", details: details)
    }

    func testProblemsSortFirstAndKeepBackendOrderWithinAStatus() {
        let entries = [
            entry(.database, .ok), entry(.foundryChat, .degraded), entry(.foundryVoice, .down),
            entry(.google, .unknown), entry(.runner, .degraded), entry(.pcBridge, .down),
        ]
        XCTAssertEqual(
            JarvisStatusLogic.ordered(entries).map(\.id),
            ["foundry.voice", "pc_bridge", "foundry.chat", "runner", "google", "database"]
        )
    }

    func testIssuesFilterHidesHealthyChecks() {
        let entries = [entry(.database, .ok), entry(.google, .unknown), entry(.runner, .down)]
        XCTAssertEqual(JarvisStatusLogic.visible(entries, filter: .all).count, 3)
        XCTAssertEqual(JarvisStatusLogic.visible(entries, filter: .issues).map(\.id), ["runner", "google"])
        XCTAssertEqual(JarvisStatusLogic.issueCount(entries), 2)
    }

    func testSnapshotIsStaleAfterFiveMinutes() {
        let now = JarvisInsightsDates.parse("2026-11-02T10:05:00Z")!
        XCTAssertFalse(JarvisStatusLogic.isStale(checkedAt: "2026-11-02T10:00:01Z", now: now))
        XCTAssertTrue(JarvisStatusLogic.isStale(checkedAt: "2026-11-02T10:00:00Z", now: now))
        XCTAssertFalse(JarvisStatusLogic.isStale(checkedAt: "not a time", now: now))
    }

    func testReasonSentences() {
        XCTAssertEqual(
            JarvisStatusLogic.reason(for: entry(.google, .unknown, details: ["configured": .bool(false)])),
            .key(.statusReasonNotConfigured)
        )
        XCTAssertEqual(
            JarvisStatusLogic.reason(for: entry(.runner, .degraded, details: ["reason": .string("sync_failed")])),
            .text("Sync failed")
        )
        XCTAssertEqual(
            JarvisStatusLogic.reason(for: entry(.foundryChat, .degraded, details: ["catalogue": .string("fallback")])),
            .key(.statusReasonCatalogueFallback)
        )
        XCTAssertEqual(
            JarvisStatusLogic.reason(for: entry(.pcBridge, .down, details: ["connected": .bool(false)])),
            .key(.statusReasonBridgeDisconnected)
        )
        XCTAssertEqual(JarvisStatusLogic.reason(for: entry(.database, .down)), .key(.statusReasonFailed))
        XCTAssertEqual(JarvisStatusLogic.reason(for: entry(.google, .unknown)), .key(.statusReasonNotEstablished))
        XCTAssertNil(JarvisStatusLogic.reason(for: entry(.database, .ok)))
    }

    func testVaultMirrorShowsStaleWhenLastSuccessIsOld() {
        let mirror = JarvisVaultMirror(state: .healthy, lastSuccessAt: "2026-11-02T10:00:00Z")
        XCTAssertEqual(mirror.displayState(now: JarvisInsightsDates.parse("2026-11-02T10:29:00Z")!), .healthy)
        XCTAssertEqual(mirror.displayState(now: JarvisInsightsDates.parse("2026-11-02T10:31:00Z")!), .stale)
        let paths = JarvisVaultMirror(state: .needsAttention, conflictPaths: (1...12).map { "n\($0).md" })
        XCTAssertEqual(paths.visibleConflictPaths.count, 10)
    }

    func testFailedRefreshKeepsTheLastSnapshotVisible() {
        let snapshot = JarvisStatusSnapshot(checkedAt: "2026-11-02T10:00:00Z", entries: [entry(.database, .ok)])
        var state = JarvisStatusViewState()
        XCTAssertTrue(state.isLoading)
        state.failed(JarvisClientError.timedOut)
        XCTAssertTrue(state.showsFullError)
        XCTAssertEqual(state.failure, .timedOut)
        state.begin()
        state.succeeded(snapshot)
        XCTAssertNil(state.failure)
        state.begin()
        state.failed(JarvisClientError.networkFailure)
        XCTAssertTrue(state.isPartial)
        XCTAssertEqual(state.snapshot, snapshot)
        XCTAssertEqual(state.failure, .offline)
        XCTAssertFalse(state.isLoading)
    }

    func testFailuresAreClassified() {
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.signInRequired), .signInRequired)
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.notOwner), .signInRequired)
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.invalidBaseURL), .notConfigured)
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.httpStatus(404)), .unavailable)
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.httpStatus(409)), .conflict)
        XCTAssertEqual(JarvisInsightsFailure(JarvisInsightsError.invalidResponse), .invalidResponse)
        XCTAssertEqual(JarvisInsightsFailure(JarvisClientError.httpStatus(500)), .failed)
    }

    func testClientRequiresAllElevenChecks() async throws {
        func body(_ count: Int) -> String {
            let ids = ["database", "foundry.chat", "foundry.voice", "foundry.embeddings", "vault_index", "github_app",
                       "google", "pc_bridge", "runner", "deployed_commit", "last_error"]
            let entries = ids.prefix(count).map {
                #"{"id": "\#($0)", "status": "ok", "checkedAt": "2026-11-02T10:00:00.000Z"}"#
            }.joined(separator: ",")
            return #"{"checkedAt": "2026-11-02T10:00:00.000Z", "entries": [\#(entries)], "vaultMirror": {"state": "not-set-up", "lastSuccessAt": null}}"#
        }
        let good = try FixtureTransport(scenario: Data(#"{"version": 1, "interactions": [{"method": "GET", "path": "/api/status", "response": {"statusCode": 200, "body": \#(body(11))}}]}"#.utf8))
        let snapshot = try await JarvisStatusClient(client: try insightsClient(good)).snapshot()
        XCTAssertEqual(snapshot.entries.count, 11)
        XCTAssertEqual(snapshot.vaultMirror?.state, .notSetUp)

        let short = try FixtureTransport(scenario: Data(#"{"version": 1, "interactions": [{"method": "GET", "path": "/api/status", "response": {"statusCode": 200, "body": \#(body(10))}}]}"#.utf8))
        do {
            _ = try await JarvisStatusClient(client: try insightsClient(short)).snapshot()
            XCTFail("Expected an invalid response")
        } catch {
            XCTAssertEqual(error as? JarvisInsightsError, .invalidResponse)
        }
    }
}

final class JarvisProactiveLogicTests: XCTestCase {
    private func status(
        paused: Bool = false, quiet: Bool = false, next: String? = "2026-11-02T11:00:00Z",
        run: JarvisProactiveRunStatus? = nil, budget: JarvisProactiveBudgetState = .ok
    ) -> JarvisProactiveStatus {
        JarvisProactiveStatus(
            paused: paused, quietNow: quiet, nextSlotAt: next,
            lastRun: run.map { JarvisProactiveRun(id: "r", status: $0, startedAt: "2026-11-02T08:00:00Z") },
            budget: JarvisProactiveBudget(month: "2026-11", monthlyLimitDkk: 50, estimatedSpendDkk: 10, state: budget),
            sources: []
        )
    }

    func testStatusSentencePriority() {
        let next = JarvisInsightsDates.parse("2026-11-02T11:00:00Z")!
        XCTAssertEqual(JarvisProactiveLogic.statusLine(status()), .nextCheck(next))
        XCTAssertEqual(JarvisProactiveLogic.statusLine(status(quiet: true)), .quietHours(next: next))
        XCTAssertEqual(JarvisProactiveLogic.statusLine(status(paused: true, quiet: true)), .paused)
        XCTAssertEqual(JarvisProactiveLogic.statusLine(status(paused: true, run: .running)), .checking)
        XCTAssertEqual(JarvisProactiveLogic.statusLine(status(next: nil)), .none)
    }

    func testCheckNowIsOfferedOnlyWhenTheBackendWouldRunIt() {
        XCTAssertTrue(JarvisProactiveLogic.canCheckNow(status(run: .done)))
        XCTAssertFalse(JarvisProactiveLogic.canCheckNow(status(paused: true)))
        XCTAssertFalse(JarvisProactiveLogic.canCheckNow(status(budget: .exhausted)))
        XCTAssertFalse(JarvisProactiveLogic.canCheckNow(status(run: .running)))
    }

    func testBudgetFraction() {
        let budget = JarvisProactiveBudget(month: "2026-11", monthlyLimitDkk: 40, estimatedSpendDkk: 10, state: .ok)
        XCTAssertEqual(budget.usedFraction, 0.25, accuracy: 0.0001)
        XCTAssertEqual(
            JarvisProactiveBudget(month: "m", monthlyLimitDkk: 0, estimatedSpendDkk: 0, state: .exhausted).usedFraction, 1
        )
        XCTAssertEqual(
            JarvisProactiveBudget(month: "m", monthlyLimitDkk: 10, estimatedSpendDkk: 30, state: .exhausted).usedFraction, 1
        )
    }

    func testSnoozeIsTomorrowAtSevenInDanishTime() {
        // 22:30 UTC on 2 November is 23:30 in Denmark, so tomorrow is 3 November: 07:00 CET is 06:00 UTC.
        let evening = JarvisInsightsDates.parse("2026-11-02T22:30:00Z")!
        XCTAssertEqual(JarvisProactiveLogic.snoozeTimestamp(now: evening), "2026-11-03T06:00:00Z")
        // 00:30 in Denmark on 3 November: tomorrow is 4 November.
        let afterMidnight = JarvisInsightsDates.parse("2026-11-02T23:30:00Z")!
        XCTAssertEqual(JarvisProactiveLogic.snoozeTimestamp(now: afterMidnight), "2026-11-04T06:00:00Z")
        // Summer time: 07:00 CEST is 05:00 UTC.
        let summer = JarvisInsightsDates.parse("2026-07-10T10:00:00Z")!
        XCTAssertEqual(JarvisProactiveLogic.snoozeTimestamp(now: summer), "2026-07-11T05:00:00Z")
    }

    func testTaskDraftCarriesTitleAndDueTime() {
        let item = JarvisProactiveItem(id: "1", title: " Pay rent ", body: "b", dueAt: "2026-11-02T22:30:00Z", createdAt: "2026-11-02T08:00:00Z")
        let draft = JarvisProactiveLogic.taskDraft(for: item)
        XCTAssertEqual(draft.text, "Pay rent")
        XCTAssertEqual(draft.due, "2026-11-02")
        XCTAssertEqual(draft.time, "23:30")
        let undated = JarvisProactiveItem(id: "2", title: "Call", body: "b", createdAt: "2026-11-02T08:00:00Z")
        XCTAssertNil(JarvisProactiveLogic.taskDraft(for: undated).due)
    }

    func testEarlierItemsExcludeOpenOnes() {
        func item(_ id: String) -> JarvisProactiveItem {
            JarvisProactiveItem(id: id, title: id, body: "", createdAt: "2026-11-02T08:00:00Z")
        }
        XCTAssertEqual(JarvisProactiveLogic.earlier(all: [item("a"), item("b"), item("c")], open: [item("b")]).map(\.id), ["a", "c"])
    }

    func testSourceReasonsMapToCopyAndFallBack() {
        XCTAssertEqual(JarvisProactiveLogic.sourceReason("timeout"), .proactiveReasonTimeout)
        XCTAssertEqual(JarvisProactiveLogic.sourceReason("surprise"), .proactiveReasonUnknown)
        XCTAssertEqual(JarvisProactiveLogic.sourceReason(nil), .proactiveReasonUnknown)
        XCTAssertEqual(JarvisProactiveSourceID.allCases.count, 12)
        XCTAssertTrue([JarvisProactiveSourceID.health, .nutrition, .notes, .memory].allSatisfy {
            JarvisProactiveSourceID.allCases.contains($0)
        })
        XCTAssertEqual(JarvisProactiveCategory.allCases.count, 9)
    }
}

final class JarvisProactiveSettingsTests: XCTestCase {
    private let base = JarvisProactiveConfig(monthlyBudgetDkk: 50, newsFeeds: ["https://example.com/feed"], guidance: "Be brief")

    func testBudgetMustBeBetweenZeroAndOneThousand() {
        var draft = JarvisProactiveSettingsDraft(base)
        for (text, valid) in [("0", true), ("1000", true), ("1001", false), ("-1", false), ("", false), ("12.5", false), ("abc", false)] {
            draft.budgetText = text
            XCTAssertEqual(draft.budget != nil, valid, text)
            XCTAssertEqual(draft.issues.contains(.budgetOutOfRange), !valid, text)
        }
    }

    func testGuidanceIsLimitedToOneThousandCharacters() {
        var draft = JarvisProactiveSettingsDraft(base)
        draft.guidance = String(repeating: "x", count: 1000)
        XCTAssertTrue(draft.isValid)
        draft.guidance += "x"
        XCTAssertEqual(draft.issues, [.guidanceTooLong])
    }

    func testFeedsMustBeHttpsLinksAtMostTen() {
        var draft = JarvisProactiveSettingsDraft(base)
        draft.feedsText = "https://a.example/rss\n\n  https://b.example/rss  "
        XCTAssertEqual(draft.feeds, ["https://a.example/rss", "https://b.example/rss"])
        XCTAssertTrue(draft.isValid)
        draft.feedsText = "http://a.example/rss"
        XCTAssertEqual(draft.issues, [.invalidFeed])
        draft.feedsText = "https://user:token@a.example/rss"
        XCTAssertEqual(draft.issues, [.invalidFeed])
        draft.feedsText = (1...11).map { "https://a.example/\($0)" }.joined(separator: "\n")
        XCTAssertEqual(draft.issues, [.tooManyFeeds])
    }

    func testAtMostTwelvePreferences() {
        var draft = JarvisProactiveSettingsDraft(base)
        draft.preferences = (1...12).map { "p\($0)" }
        XCTAssertTrue(draft.isValid)
        draft.preferences.append("p13")
        XCTAssertEqual(draft.issues, [.tooManyPreferences])
        XCTAssertFalse(JarvisProactiveConfig(preferences: (1...13).map { "p\($0)" }).isValid)
        XCTAssertTrue(JarvisProactiveConfig(preferences: (1...12).map { "p\($0)" }).isValid)
    }

    func testPatchHoldsOnlyChangedFieldsAndTheRevision() throws {
        var draft = JarvisProactiveSettingsDraft(base)
        XCTAssertEqual(draft.patch(from: base)?.isEmpty, true)
        draft.paused = true
        draft.budgetText = "75"
        draft.scope = .work
        draft.sources[1].enabled = false
        draft.categories[0].enabled = false
        draft.guidance = "Short"
        let patch = try XCTUnwrap(draft.patch(from: base))
        XCTAssertEqual(patch.paused, true)
        XCTAssertEqual(patch.monthlyBudgetDkk, 75)
        XCTAssertEqual(patch.suggestionScope, .work)
        XCTAssertEqual(patch.sources, [JarvisProactiveToggle(id: .calendar, enabled: false)])
        XCTAssertEqual(patch.categories, [JarvisProactiveToggle(id: .deadline, enabled: false)])
        XCTAssertNil(patch.newsFeeds)
        XCTAssertEqual(patch.guidance, "Short")
        XCTAssertEqual(patch.expectedRevision, base.revision)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["paused", "monthlyBudgetDkk", "sources", "categories", "suggestionScope", "guidance", "expectedRevision"])
        draft.budgetText = "5000"
        XCTAssertNil(draft.patch(from: base))
    }

    func testSettingsFromTheBackendAreValidated() {
        XCTAssertTrue(base.isValid)
        XCTAssertFalse(JarvisProactiveConfig(monthlyBudgetDkk: 1001).isValid)
        XCTAssertFalse(JarvisProactiveConfig(guidance: String(repeating: "x", count: 1001)).isValid)
        XCTAssertFalse(JarvisProactiveConfig(revision: "short").isValid)
    }

    func testSaveFlowSavedFailedRetry() throws {
        var editor = JarvisProactiveSettingsEditor(settings: base)
        XCTAssertFalse(editor.canConfirm)
        XCTAssertNil(editor.beginSave())

        editor.draft.budgetText = "80"
        editor.draft.paused = true
        XCTAssertTrue(editor.isDirty)
        XCTAssertTrue(editor.canConfirm)

        let first = try XCTUnwrap(editor.beginSave())
        XCTAssertEqual(editor.state, .saving)
        XCTAssertNil(editor.beginSave(), "A save already in flight must not start a second one")
        editor.saveFailed(JarvisClientError.networkFailure)
        XCTAssertEqual(editor.state, .failed(.offline))
        XCTAssertEqual(editor.draft.budgetText, "80", "A failed save keeps the edits")
        XCTAssertTrue(editor.canRetry)

        let retry = try XCTUnwrap(editor.beginSave())
        XCTAssertEqual(retry, first)
        let revision = String(repeating: "b", count: 64)
        let updated = JarvisProactiveConfig(paused: true, monthlyBudgetDkk: 80, newsFeeds: base.newsFeeds, guidance: base.guidance, revision: revision)
        editor.saveSucceeded(updated)
        XCTAssertEqual(editor.state, .saved)
        XCTAssertFalse(editor.isDirty)
        XCTAssertEqual(editor.saved.revision, revision)
        XCTAssertEqual(editor.draft.budgetText, "80")
    }

    func testConflictCanBeRebasedWithoutLosingEdits() throws {
        var editor = JarvisProactiveSettingsEditor(settings: base)
        editor.draft.guidance = "Mine"
        _ = try XCTUnwrap(editor.beginSave())
        editor.saveFailed(JarvisClientError.httpStatus(409))
        XCTAssertEqual(editor.state, .failed(.conflict))
        let revision = String(repeating: "c", count: 64)
        editor.rebase(onto: JarvisProactiveConfig(monthlyBudgetDkk: 60, newsFeeds: base.newsFeeds, guidance: "Theirs", revision: revision))
        XCTAssertEqual(editor.draft.guidance, "Mine")
        XCTAssertEqual(try XCTUnwrap(editor.beginSave()).expectedRevision, revision)
    }

    func testDiscardRestoresSavedValues() {
        var editor = JarvisProactiveSettingsEditor(settings: base)
        editor.draft.guidance = "Changed"
        editor.discard()
        XCTAssertFalse(editor.isDirty)
        XCTAssertEqual(editor.draft.guidance, "Be brief")
        XCTAssertEqual(editor.state, .idle)
    }

    func testInvalidDraftCannotBeConfirmedOrRetried() throws {
        var editor = JarvisProactiveSettingsEditor(settings: base)
        editor.draft.budgetText = "2000"
        XCTAssertFalse(editor.canConfirm)
        XCTAssertNil(editor.beginSave())
        XCTAssertFalse(editor.canRetry)
    }

    func testClientPatchesSettingsWithTheExpectedRevision() async throws {
        let revision = String(repeating: "a", count: 64)
        let next = String(repeating: "b", count: 64)
        let sources = JarvisProactiveSourceID.allCases.map { #"{"id": "\#($0.rawValue)", "enabled": true}"# }.joined(separator: ",")
        let categories = JarvisProactiveCategory.allCases.map { #"{"id": "\#($0.rawValue)", "enabled": true}"# }.joined(separator: ",")
        let transport = try FixtureTransport(scenario: Data("""
        {"version": 1, "interactions": [{
          "method": "PATCH", "path": "/api/proactive/settings",
          "requestBody": {"monthlyBudgetDkk": 80, "expectedRevision": "\(revision)"},
          "response": {"statusCode": 200, "body": {
            "paused": false, "monthlyBudgetDkk": 80, "sources": [\(sources)], "categories": [\(categories)],
            "suggestionScope": "all", "newsFeeds": [], "guidance": "", "revision": "\(next)",
            "preferences": ["Automatic proactive suggestions are on."],
            "capabilities": {"title": {"en": "a", "da": "b"}, "examples": []}
          }}
        }]}
        """.utf8))
        var draft = JarvisProactiveSettingsDraft(JarvisProactiveConfig(revision: revision))
        draft.budgetText = "80"
        let patch = try XCTUnwrap(draft.patch(from: JarvisProactiveConfig(revision: revision)))
        let saved = try await JarvisProactiveClient(client: try insightsClient(transport)).updateSettings(patch)
        XCTAssertEqual(saved.monthlyBudgetDkk, 80)
        XCTAssertEqual(saved.revision, next)
        XCTAssertEqual(saved.sources.count, 12)
    }

    func testNotificationOpensConversationWithoutSubmittingATurn() async throws {
        let id = "11111111-1111-4111-8111-111111111111"
        let transport = try FixtureTransport(scenario: Data("""
        {"version":1,"interactions":[
          {"method":"POST","path":"/api/proactive/items/\(id)/conversation",
           "requestBody":{},"response":{"statusCode":204}},
          {"method":"POST","path":"/api/proactive/items/\(id)/conversation",
           "requestBody":{},"response":{"statusCode":204}}
        ]}
        """.utf8))
        let client = JarvisProactiveClient(client: try insightsClient(transport))
        try await client.openConversation(id: id)
        try await client.openConversation(id: id)
        do {
            try await client.openConversation(id: "../../settings")
            XCTFail("Invalid identity must not issue a request")
        } catch {
            XCTAssertEqual(error as? JarvisInsightsError, .invalidRequest)
        }
    }

    func testNotificationLoadsItsExactFindingAndRejectsInvalidIdentity() async throws {
        let id = "11111111-1111-4111-8111-111111111111"
        let item = JarvisProactiveItem(id: id, title: "Useful opportunity", body: "Based on recorded progress.",
            category: .suggestion, createdAt: "2026-11-09T10:00:00Z")
        let body = String(decoding: try JSONEncoder().encode(item), as: UTF8.self)
        let transport = try FixtureTransport(scenario: Data("""
        {"version":1,"interactions":[{"method":"GET","path":"/api/proactive/items/\(id)","response":{"statusCode":200,"body":\(body)}}]}
        """.utf8))
        let client = JarvisProactiveClient(client: try insightsClient(transport))
        let loaded = try await client.item(id: id)
        XCTAssertEqual(loaded, item)
        do {
            _ = try await client.item(id: "../../settings")
            XCTFail("Invalid notification identity must not issue a request")
        } catch {
            XCTAssertEqual(error as? JarvisInsightsError, .invalidRequest)
        }
    }

    func testClientMapsAMissingFeatureToUnavailable() async throws {
        let transport = try FixtureTransport(scenario: Data(#"{"version": 1, "interactions": [{"method": "GET", "path": "/api/proactive/status", "response": {"statusCode": 404, "body": {"error": "not_found"}}}]}"#.utf8))
        do {
            _ = try await JarvisProactiveClient(client: try insightsClient(transport)).status()
            XCTFail("Expected a 404")
        } catch {
            XCTAssertEqual(JarvisInsightsFailure(error), .unavailable)
        }
    }

    func testCheckNowAcceptsTheAcceptedStatus() async throws {
        let transport = try FixtureTransport(scenario: Data(#"{"version": 1, "interactions": [{"method": "POST", "path": "/api/proactive/runs", "response": {"statusCode": 202, "body": {"run": {}}}}]}"#.utf8))
        try await JarvisProactiveClient(client: try insightsClient(transport)).checkNow()
    }

    func testClientPostsSnoozeFeedback() async throws {
        let transport = try FixtureTransport(scenario: Data("""
        {"version": 1, "interactions": [{
          "method": "POST", "path": "/api/proactive/items/abc/feedback",
          "requestBody": {"action": "snooze", "snoozeUntil": "2026-11-03T06:00:00Z"},
          "response": {"statusCode": 200, "body": {
            "id": "abc", "kind": "finding", "title": "T", "body": "B", "category": null, "urgency": "normal",
            "dueAt": null, "evidence": [], "state": "snoozed", "snoozedUntil": "2026-11-03T06:00:00.000Z",
            "feedback": null, "runId": null, "todoAdded": false, "language": "en", "createdAt": "2026-11-02T08:00:00.000Z"
          }}
        }]}
        """.utf8))
        let item = try await JarvisProactiveClient(client: try insightsClient(transport))
            .apply(.snooze(until: "2026-11-03T06:00:00Z"), to: "abc")
        XCTAssertEqual(item.state, .snoozed)
    }
}

private func insightsClient(_ transport: FixtureTransport) throws -> JarvisClient {
    try JarvisClient(
        configuration: JarvisClientConfiguration(
            baseURL: URL(string: "https://api.example.invalid/api")!,
            retryPolicy: RetryPolicy(maximumRetries: 0)
        ),
        transport: transport,
        tokenStore: InsightsTokenStore(),
        accessTokenProvider: InsightsTokenProvider()
    )
}

private actor InsightsTokenStore: TokenStore {
    private var token: String? = "synthetic.owner.session"

    func read() async throws -> String? { token }
    func write(_ token: String) async throws { self.token = token }
    func delete() async throws { token = nil }
}

private struct InsightsTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "synthetic.entra.token" }
    func requestSignIn() async {}
}
