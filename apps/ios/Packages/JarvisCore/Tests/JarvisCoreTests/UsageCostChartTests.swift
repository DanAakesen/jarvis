import XCTest
@testable import JarvisCore

final class UsageCostChartTests: XCTestCase {
    // The breakdown is capped and each group carries its most recent event timestamp.
    private let latest = JarvisUsageEntry(agent: "jarvis", source: "jarvis_model", metric: "input_tokens",
        quantity: 100, costDkk: 9, at: "2026-01-31T23:50:00Z")

    func testDailyCostsUseUtcLedgerDatesAndIncludeOldestPartialDay() {
        let report = JarvisUsageReport(period: "7d", from: "2026-01-24T23:59:00Z", to: "2026-01-31T23:59:00Z",
            entries: [latest], totalEntries: "4", truncated: true, healthCostTotals: [
                .init(period: "2026-01-24", dkk: 11, estimatedEntries: 3),
                .init(period: "2026-01-31", dkk: 9, estimatedEntries: 1)
            ])
        let summary = JarvisUsageSummary(report: report, period: .sevenDays)
        XCTAssertEqual(summary.totalValue, 20)
        XCTAssertTrue(summary.hasEstimates)
        XCTAssertEqual(summary.buckets.first?.startKey, "2026-01-24")
        XCTAssertEqual(summary.buckets.first?.value, 11)
        XCTAssertEqual(summary.buckets.last?.startKey, "2026-01-31")
        XCTAssertEqual(summary.buckets.last?.value, 9)
        XCTAssertEqual(summary.totals(in: summary.buckets.last).tokens, 100)
    }

    func testAllUsesMonthlyLedgerIncludingHistoryBeyondDailyCoverage() {
        let report = JarvisUsageReport(period: "all", from: nil, to: "2026-01-31T23:59:00Z",
            entries: [latest], totalEntries: "1", healthCostTotals: [
                .init(period: "2026-01-31", dkk: 9, estimatedEntries: 1)
            ], monthlyCostTotals: [
                .init(period: "2025-06", dkk: 30, estimatedEntries: 2),
                .init(period: "2026-01", dkk: 9, estimatedEntries: 1)
            ])
        let summary = JarvisUsageSummary(report: report, period: .all)
        XCTAssertEqual(summary.buckets.first?.startKey, "2025-06-01")
        XCTAssertEqual(summary.buckets.first?.value, 30)
        XCTAssertEqual(summary.totalValue, 39)
    }
}
