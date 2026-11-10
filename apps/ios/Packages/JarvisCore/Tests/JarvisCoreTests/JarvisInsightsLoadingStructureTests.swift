import Foundation
import XCTest

/// Linux guards for the native structure; rendered behavior is covered by InsightsPagesTests on iOS.
final class JarvisInsightsLoadingStructureTests: XCTestCase {
    private func source(_ name: String) throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return try String(contentsOf: root.appendingPathComponent("apps/ios/Jarvis/\(name).swift"), encoding: .utf8)
    }

    private func section(_ text: String, from start: String, to end: String) throws -> String {
        let startRange = try XCTUnwrap(text.range(of: start))
        let endRange = try XCTUnwrap(text.range(of: end, range: startRange.upperBound..<text.endIndex))
        return String(text[startRange.upperBound..<endRange.lowerBound])
    }

    func testInsightsDoNotReplaceStaticPagesWithPageLoadingViews() throws {
        for screen in ["JarvisUsageArea", "JarvisStatusArea", "JarvisProactiveArea", "JarvisProactiveSettingsSheet"] {
            XCTAssertFalse(try source(screen).contains("JarvisPageLoadingView("), screen)
        }
    }

    func testUsageMountsSectionsIndependentlyOfReportAndGuardsPeriodResponses() throws {
        let text = try source("JarvisUsageArea")
        let content = try section(text, from: "@ViewBuilder private var content:", to: "@ViewBuilder private var pendingData:")
        for call in ["overview(summary)", "breakdown(summary)", "topTasks(summary)", "toolCalls(summary)"] {
            XCTAssertTrue(content.contains(call), call)
        }
        XCTAssertTrue(text.contains("value.period == period"))
        XCTAssertTrue(text.contains("requestID == currentRequest, period == selected"))
        let reload = try section(text, from: "private func reload()", to: "// MARK: Loaded")
        let resetRange = try XCTUnwrap(reload.range(of: "if loadedPeriod != selected"))
        let guardRange = try XCTUnwrap(reload.range(of: "guard let client"))
        let resets = String(reload[resetRange.upperBound..<guardRange.lowerBound])
        for selection in ["selectedBucketID = nil", "chartSelection = nil", "selectedSliceID = nil"] {
            XCTAssertTrue(resets.contains(selection), selection)
            XCTAssertEqual(reload.components(separatedBy: selection).count - 1, 1, "Do not reset on same-period refresh")
        }
    }

    func testStatusMountsOverviewAndFilterBeforeItsSnapshotBranch() throws {
        let content = try section(try source("JarvisStatusArea"), from: "@ViewBuilder private var content:", to: "private var overview:")
        let snapshot = try XCTUnwrap(content.range(of: "if let snapshot = state.snapshot"))
        let structure = String(content[..<snapshot.lowerBound])
        XCTAssertTrue(structure.contains("overview"))
        XCTAssertTrue(structure.contains("JarvisSegmentedBar("))
    }

    func testProactiveItemsAndRunsAreNotGatedByStatus() throws {
        let text = try source("JarvisProactiveArea")
        let content = try section(text, from: "@ViewBuilder private var content:", to: "@ViewBuilder private func statusDataState")
        for call in ["nextCheckCard(loadedStatus)", "itemsCard", "sourcesCard(loadedStatus)", "budgetCard(loadedStatus?.budget)", "runsCard"] {
            XCTAssertTrue(content.contains(call), call)
        }
        XCTAssertFalse(content.contains("switch status"))
        XCTAssertTrue(text.contains("async let itemsDone:"))
        XCTAssertTrue(text.contains("async let runsDone:"))
        XCTAssertTrue(text.contains("runsLoaded = true"))
        XCTAssertTrue(text.contains("identifier: \"proactive.runs.error\""))
    }

    func testSettingsMountsFormAndDoesNotInventSettingsWhileLoading() throws {
        let text = try source("JarvisProactiveSettingsSheet")
        let body = try section(text, from: "var body: some View", to: "// MARK: Loading and saving")
        XCTAssertTrue(body.contains("form"))
        XCTAssertFalse(body.contains("if editor != nil"))
        XCTAssertTrue(text.contains("pendingValue(text(.editorPause))"))
        XCTAssertTrue(text.contains("get: { editor?.draft.scope }"))
        XCTAssertTrue(text.contains(".disabled(editor == nil)"))
        XCTAssertTrue(text.contains(".accessibilityValue(pendingText)"))
    }

    func testFactoryTaskStructureAndActivityNoticeStayInsideRetainedList() throws {
        let text = try source("JarvisFactoryTaskDetailView")
        let content = try section(text, from: "private func detailContent(", to: "private var detailPlaceholder:")
        let list = try XCTUnwrap(content.range(of: "JarvisList {"))
        let notice = try XCTUnwrap(content.range(of: "JarvisTaskActivityNotice(language: language)"))
        let failure = try XCTUnwrap(content.range(of: "if loadFailed"))
        XCTAssertLessThan(list.lowerBound, notice.lowerBound)
        XCTAssertLessThan(notice.lowerBound, failure.lowerBound)
        XCTAssertFalse(text.contains(".safeAreaInset"))
        var previous = list.lowerBound
        for key in ["actions", "metadata", "request", "timeline", "usage", "artifacts"] {
            let heading = try XCTUnwrap(content.range(of: "Section(copy.text(.\(key)))"))
            XCTAssertLessThan(previous, heading.lowerBound)
            previous = heading.lowerBound
        }
        XCTAssertFalse(content.contains("Section(copy.text(.disk))"))
        XCTAssertTrue(content.contains("JarvisFactoryRequestView(request: task.request, copy: copy)"))
        XCTAssertTrue(content.contains(".id(task.id)"))
        XCTAssertTrue(content.contains(".refreshable { await loadTask() }"))
    }

    func testRetainedFailuresOfferSharedRetryControls() throws {
        let identifiers = [
            "JarvisUsageArea": "usage.refreshFailed.retry",
            "JarvisStatusArea": "status.partial.retry",
            "JarvisProactiveArea": "proactive.refresh.retry",
        ]
        for (screen, identifier) in identifiers {
            XCTAssertTrue(try source(screen).contains("identifier: \"\(identifier)\""), screen)
        }
    }

    func testLoadingGroupsContainRatherThanOverwriteActionIdentifiers() throws {
        let groups = [
            ("JarvisFactoryArea", "factory.segmentRow", "factory.filters"),
            ("JarvisUsageArea", "usage.refreshFailed", "usage.refreshFailed.retry"),
            ("JarvisProactiveArea", "proactive.items", "proactive.item."),
        ]
        for (screen, group, child) in groups {
            let text = try source(screen)
            let normalized = text.components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
            XCTAssertTrue(normalized.contains(
                ".accessibilityElement(children: .contain)\n.accessibilityIdentifier(\"\(group)\")"
            ), "\(screen) must preserve individual child identifiers")
            XCTAssertTrue(text.contains(child))
        }
    }
}
