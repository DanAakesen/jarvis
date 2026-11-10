import Foundation
import XCTest

/// Native SwiftUI builds run in Apple CI; these guards protect its source/target routing on Linux too.
final class WatchDashboardSourceTests: XCTestCase {
    private func source(_ path: String) throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    func testDashboardPrecedesUnchangedActionsInNativeHorizontalPages() throws {
        let app = try source("apps/ios/Watch/JarvisWatchApp.swift")
        XCTAssertTrue(app.contains("WatchDashboardView().tag(0)"))
        XCTAssertTrue(app.contains("actionPage.tag(1)"))
        XCTAssertTrue(app.contains(".tabViewStyle(.page(indexDisplayMode: .automatic))"))
        for action in ["Voice", "Dictate", "Factory"] {
            XCTAssertTrue(app.contains("\"\(action)\""))
        }
        XCTAssertTrue(app.contains("case .tasks: WatchTasksView()"))
        for flag in ["tasks", "personal-new-task", "task-detail", "complications", "new-task"] {
            XCTAssertTrue(app.contains("--watch-screen=\(flag)"))
        }
        for route in ["agenda", "bodyFat", "notes", "home", "nutrition", "tasks", "logLift"] {
            XCTAssertTrue(app.contains("case .\(route): path = [.\(route)]"))
        }
        XCTAssertTrue(app.contains("WatchAppLink(url: url)"))
    }

    func testDashboardOrderAndWholeUpNextAgendaLink() throws {
        let dashboard = try source("apps/ios/Watch/WatchDashboardViews.swift")
        let headings = ["upNext(snapshot", "\"Workouts\"", "\"Body Fat\"", "\"Tasks\"", "\"Recent Notes\""]
        var previous = dashboard.startIndex
        for heading in headings {
            let range = try XCTUnwrap(dashboard.range(of: heading, range: previous..<dashboard.endIndex))
            previous = range.upperBound
        }
        let upNext = try XCTUnwrap(dashboard.range(of: "private func upNext"))
        let workouts = try XCTUnwrap(dashboard.range(of: "private func workouts"))
        let agenda = String(dashboard[upNext.lowerBound..<workouts.lowerBound])
        XCTAssertTrue(agenda.contains("NavigationLink(value: WatchRoute.agenda)"))
        XCTAssertTrue(agenda.contains("WatchAgendaTimeline"))
        XCTAssertFalse(agenda.contains("See more"))
    }

    func testDebugCaptureCanScrollToEveryLowerDashboardSection() throws {
        let dashboard = try source("apps/ios/Watch/WatchDashboardViews.swift")
        for section in ["workouts", "body-fat", "tasks", "notes"] {
            XCTAssertTrue(dashboard.contains(".id(\"\(section)\")"))
        }
        let debugStart = try XCTUnwrap(dashboard.range(of: "#if DEBUG"))
        let debugEnd = try XCTUnwrap(dashboard.range(of: "#endif", range: debugStart.upperBound..<dashboard.endIndex))
        let debug = String(dashboard[debugStart.upperBound..<debugEnd.lowerBound])
        XCTAssertTrue(debug.contains("ProcessInfo.processInfo.arguments.contains(\"--watch-fixture\")"))
        XCTAssertTrue(debug.contains("[\"workouts\", \"body-fat\", \"tasks\", \"notes\"]"))
        XCTAssertTrue(debug.contains("--watch-dashboard-section=\\($0)"))
        XCTAssertTrue(debug.contains("proxy.scrollTo(section, anchor: .top)"))
        let scroll = try XCTUnwrap(debug.range(of: "proxy.scrollTo"))
        let ready = try XCTUnwrap(debug.range(of: "WatchPreview.captureReady(\"dashboard\")"))
        XCTAssertLessThan(scroll.lowerBound, ready.lowerBound)
    }

    func testFourNewRectangularComplicationsHaveDistinctDestinations() throws {
        let widgets = try source("apps/ios/WatchWidgets/JarvisWatchWidgets.swift")
        let registrations = [
            ("Nutrition", "nutrition", "nutrition"),
            ("Home", "home", "home"),
            ("TaskList", "task-list", "tasks"),
            ("BodyFat", "body-fat", "bodyFat")
        ]
        for (type, kind, route) in registrations {
            let start = try XCTUnwrap(widgets.range(of: "struct JarvisWatch\(type)Widget: Widget"))
            let next = widgets.range(of: "\nstruct ", range: start.upperBound..<widgets.endIndex)?.lowerBound ?? widgets.endIndex
            let widget = String(widgets[start.lowerBound..<next])
            XCTAssertTrue(widget.contains("\"jarvis.watch.\(kind)\""))
            XCTAssertTrue(widget.contains(".widgetURL(WatchAppLink.\(route).url)"))
            XCTAssertTrue(widget.contains(".supportedFamilies([.accessoryRectangular])"))
            XCTAssertTrue(widget.contains(".privacySensitive()"))
        }
        XCTAssertTrue(widgets.contains("value.dashboard?.brief?.generatedAt.addingTimeInterval(900)"))
    }

    func testApprovedStepsAndCircularWidgetsRemainSeparate() throws {
        let views = try source("apps/ios/Watch/WatchComplicationViews.swift")
        let start = try XCTUnwrap(views.range(of: "struct WatchHealthView: View"))
        let steps = String(views[start.lowerBound...])
        XCTAssertEqual(steps.components(separatedBy: "Text(").count - 1, 1)
        XCTAssertTrue(steps.contains("WatchStepsPlot(values: values, goal: goal)"))
        XCTAssertTrue(steps.contains("dash: [3, 2]"))
        XCTAssertFalse(steps.contains("Weekly"))
        let widgets = try source("apps/ios/WatchWidgets/JarvisWatchWidgets.swift")
        for type in ["Tasks", "Dictate", "Voice"] {
            let start = try XCTUnwrap(widgets.range(of: "struct JarvisWatch\(type)Widget: Widget"))
            let next = widgets.range(of: "\nstruct ", range: start.upperBound..<widgets.endIndex)?.lowerBound ?? widgets.endIndex
            XCTAssertTrue(widgets[start.lowerBound..<next].contains(".supportedFamilies([.accessoryCircular])"))
        }
    }

    func testWidgetTargetSharesProductionViewsAndHasNoDirectNetworkReads() throws {
        let project = try source("apps/ios/project.yml")
        XCTAssertTrue(project.contains("- path: Watch/WatchDesign.swift"))
        XCTAssertTrue(project.contains("- path: Watch/WatchComplicationViews.swift"))
        for path in ["Watch/WatchDashboardViews.swift", "Watch/WatchDashboardFullViews.swift", "WatchWidgets/JarvisWatchWidgets.swift"] {
            let text = try source("apps/ios/\(path)")
            XCTAssertFalse(text.contains("URLSession"))
            XCTAssertFalse(text.contains("JarvisClient("))
        }
    }

    func testSharedViewDeclarationsAreVisibleToBothTargets() throws {
        let shared = try source("apps/ios/Watch/WatchComplicationViews.swift")
        for name in ["WatchNutritionComplicationView", "WatchHomeComplicationView", "WatchTasksComplicationView",
                     "WatchBodyFatComplicationView", "WatchBodyFatChart", "WatchBriefText", "WatchMacroBar"] {
            XCTAssertTrue(shared.contains("\nstruct \(name): View"), "\(name) must be a top-level shared view")
        }
        XCTAssertTrue(shared.contains("\nenum WatchDashboardFormatting"))
        let dashboard = try source("apps/ios/Watch/WatchDashboardViews.swift")
        XCTAssertTrue(dashboard.contains("\nstruct WatchComplicationPreviewView: View"))
        for name in ["WatchNutritionComplicationView", "WatchHomeComplicationView", "WatchTasksComplicationView", "WatchBodyFatComplicationView"] {
            XCTAssertTrue(dashboard.contains("\(name)(entry: entry).frame(width: width, height: height)"))
        }
        XCTAssertTrue(dashboard.contains("let width = min(193, proxy.size.width)"))
    }

    func testTaskChoiceBarIsTopLevelAndKeepsSelectionAccessibility() throws {
        let input = try source("apps/ios/Watch/WatchTextInput.swift")
        XCTAssertTrue(input.contains("\n}\n\nstruct WatchChoiceBar<Value: Hashable>: View {"))
        XCTAssertTrue(input.contains(".accessibilityAddTraits(selection == value ? .isSelected : [])"))
    }

    func testCompactTaskTabsKeepWholeLabelsAndAdaptWithoutChangingEditorDefaults() throws {
        let input = try source("apps/ios/Watch/WatchTextInput.swift")
        let tasks = try source("apps/ios/Watch/WatchTasksView.swift")
        XCTAssertTrue(input.contains("var compact = false"))
        XCTAssertTrue(input.contains("var counts: [Value: String] = [:]"))
        XCTAssertTrue(input.contains("ViewThatFits(in: .horizontal)"))
        XCTAssertTrue(input.contains("VStack(spacing: 4) { buttons }"))
        XCTAssertTrue(input.contains("Text(title).fixedSize(horizontal: true, vertical: false)"))
        XCTAssertTrue(input.contains("minHeight: compact ? 44 : 40"))
        XCTAssertFalse(input.contains("minimumScaleFactor"), "Use a vertical fallback instead of shrinking accessible labels")
        XCTAssertTrue(tasks.contains("selection: $tab, compact: true, counts: tabCounts"))
        XCTAssertTrue(tasks.contains("choices: [(.auto, \"Auto\"), (.manual, \"Manual\")], selection: modeBinding"))
    }

    func testTaskCountUsesTodayGroupAndDoesNotClaimUnknownOrPartialTotals() throws {
        let tasks = try source("apps/ios/Watch/WatchTasksView.swift")
        XCTAssertTrue(tasks.contains("guard !loading, failure == nil, connection.reachable else { return [:] }"))
        XCTAssertTrue(tasks.contains("return [.today: \"\\(groups.today.count)\" + (hasMore ? \"+\" : \"\")]"))
        XCTAssertTrue(tasks.contains("tab == .today ? groups.today : groups.upcoming"))
        XCTAssertTrue(tasks.contains("today: taskDay ?? JarvisTodayTaskLists.dayKey(Date())"))
        XCTAssertTrue(tasks.contains("Button(\"Load more tasks\")"))
    }

    func testTaskHeaderKeepsAddOutsideTabsAndRowsExposeDetailAffordance() throws {
        let tasks = try source("apps/ios/Watch/WatchTasksView.swift")
        let toolbar = try XCTUnwrap(tasks.range(of: "ToolbarItem(placement: .topBarTrailing)"))
        let add = try XCTUnwrap(tasks.range(of: "WatchAddButton(title: \"New task\")"))
        XCTAssertLessThan(toolbar.lowerBound, add.lowerBound)
        XCTAssertTrue(tasks.contains(".navigationBarTitleDisplayMode(.inline)"))
        XCTAssertTrue(tasks.contains(".accessibilityHint(\"Opens task details\")"))
        let rowStart = try XCTUnwrap(tasks.range(of: "struct WatchPersonalTaskRow"))
        let detailStart = try XCTUnwrap(tasks.range(of: "struct WatchTaskDetailView"))
        let row = String(tasks[rowStart.lowerBound..<detailStart.lowerBound])
        XCTAssertTrue(row.contains("Image(systemName: \"chevron.right\")"))
        XCTAssertTrue(row.contains(".accessibilityElement(children: .combine)"))
        XCTAssertTrue(row.contains("minHeight: 44"))
        XCTAssertFalse(row.contains(".lineLimit(2)"), "Larger text and long task titles must remain readable")
    }

    func testUpNextPrioritizesRelativeTimingAndUsesSectionMarkersWithoutAccentRail() throws {
        let dashboard = try source("apps/ios/Watch/WatchDashboardViews.swift")
        let upNext = try XCTUnwrap(dashboard.range(of: "private func upNext"))
        let workouts = try XCTUnwrap(dashboard.range(of: "private func workouts"))
        let agenda = String(dashboard[upNext.lowerBound..<workouts.lowerBound])
        XCTAssertTrue(agenda.contains("WatchDashboardHeading(title: \"Up Next\")"))
        let relative = try XCTUnwrap(agenda.range(of: "next.start.formatted(.relative"))
        let interval = try XCTUnwrap(agenda.range(of: "Text(next.start.formatted(date:"))
        XCTAssertLessThan(relative.lowerBound, interval.lowerBound)
        XCTAssertTrue(agenda.contains(".font(.system(.body, design: .rounded, weight: .semibold)).foregroundStyle(WatchStyle.amber)"))
        XCTAssertTrue(dashboard.contains("WatchDashboardHeading(title: title)"))
        XCTAssertTrue(dashboard.contains("Image(systemName: \"circle.fill\")"))
        XCTAssertFalse(dashboard.contains(".border("))
        XCTAssertFalse(dashboard.contains("WatchSurface(radius: 18)"), "The menu should not add a competing ornamental surface")
        XCTAssertTrue(dashboard.contains("start.addingTimeInterval(3 * 3600)"))
        XCTAssertTrue(dashboard.contains("ForEach(0..<4)"))
        XCTAssertTrue(dashboard.contains("context.stroke(marker, with: .color(WatchStyle.amber), lineWidth: 1)"),
                      "Amber marks the actual current time inside the data timeline, not a decorative section rail")
    }

    func testTaskSourceAndConflictDetailsUseWatchSupportedNavigation() throws {
        let tasks = try source("apps/ios/Watch/WatchTasksView.swift")
        XCTAssertFalse(tasks.contains("DisclosureGroup("), "DisclosureGroup is unavailable on watchOS")
        for title in ["Vault source", "Current saved task"] {
            XCTAssertTrue(tasks.contains("NavigationLink(\"\(title)\") {"))
            XCTAssertTrue(tasks.contains(".navigationTitle(\"\(title)\")"))
        }
    }

    func testSourceAgePartialFieldsAndTaskCountFallbackAreExplicit() throws {
        let shared = try source("apps/ios/Watch/WatchComplicationViews.swift")
        let full = try source("apps/ios/Watch/WatchDashboardFullViews.swift")
        let dashboard = try source("apps/ios/Watch/WatchDashboardViews.swift")
        XCTAssertTrue(shared.contains("showDates: true"))
        XCTAssertTrue(shared.contains("Text(label + (partial ? \"*\" : \"\"))"))
        for field in ["CARB", "FAT", "PROT"] {
            let marker = "WatchDashboardFormatting.isPartialNutrient(\"\(field)\", in: nutrition.partialNutrients)"
            XCTAssertTrue(shared.contains(marker))
            XCTAssertTrue(full.contains(marker))
        }
        XCTAssertTrue(shared.contains("else if entry.current, let count = entry.health?.tasksToday"))
        XCTAssertTrue(dashboard.contains("health.isCurrent(at: context.date), let count = health.tasksToday"))
        XCTAssertTrue(full.contains("var label = \"Read\""))
        XCTAssertTrue(full.contains("WatchReadFreshness(date: brief.generatedAt, label: \"Generated\")"))
        XCTAssertTrue(full.contains("Source updated "))
        XCTAssertTrue(full.contains("Showing part of this note. Read more to continue."))
    }
}
