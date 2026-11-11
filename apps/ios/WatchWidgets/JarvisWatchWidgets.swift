import JarvisCore
import SwiftUI
import WidgetKit

struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry { .init(date: Date(), health: nil, current: false) }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let value = entry()
        let expiries = [value.health?.expiresAt(), value.dashboard?.expiresAt(),
                        value.dashboard?.brief?.generatedAt.addingTimeInterval(900)]
            .compactMap { $0 }.filter { $0 > value.date }.sorted()
        let entries = [value] + Array(Set(expiries)).sorted().map { entry(at: $0) }
        completion(Timeline(entries: entries, policy: .after(value.date.addingTimeInterval(900))))
    }
    private func entry(at date: Date = Date()) -> WatchEntry {
        let store = WatchSnapshotStore.appGroup()
        let snapshot = store?.load(.health).flatMap { try? JSONDecoder().decode(WatchHealthSnapshot.self, from: $0) }
        let dashboard = store?.load(.dashboard).flatMap { try? JSONDecoder().decode(WatchDashboardSnapshot.self, from: $0) }
        let current = snapshot?.isCurrent(at: date) == true
        return .init(date: date, health: snapshot?.version == 1 ? snapshot : nil, current: current,
                     dashboard: dashboard?.version == 1 ? dashboard : nil,
                     dashboardStale: dashboard != nil && dashboard?.isCurrent(at: date) != true)
    }
}

struct JarvisWatchHealthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.health", provider: WatchProvider()) { entry in
            WatchHealthView(entry: entry).containerBackground(.black, for: .widget).widgetURL(WatchAppLink.health.url)
        }.configurationDisplayName("Daily steps").description("Daily steps and progress toward your goal from iPhone.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchTasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.tasks", provider: WatchProvider()) { entry in
            VStack(spacing: 0) {
                HStack(spacing: 5) {
                    WatchGlyph(kind: .tasks).frame(width: 16, height: 20)
                    Text(entry.health?.tasksToday.map(String.init) ?? "—").font(.system(size: 25, weight: .semibold, design: .rounded)).minimumScaleFactor(0.5)
                }
                if !entry.current, let health = entry.health { WatchSnapshotAge(date: health.generatedAt) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle()).containerBackground(.black, for: .widget)
                .widgetURL(WatchAppLink.tasks.url)
                .accessibilityLabel(entry.health?.tasksToday.map { "\($0) tasks due today" } ?? "Today's tasks unavailable")
                .accessibilityValue(!entry.current && entry.health != nil
                                    ? Text("Saved") + Text(" ") + Text(entry.health!.generatedAt, style: .relative)
                                    : Text(""))
        }.configurationDisplayName("Tasks Today").description("Remaining tasks due today.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchDictateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.dictate", provider: WatchProvider()) { _ in
            WatchGlyph(kind: .dictate).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle())
                .containerBackground(.black, for: .widget).widgetURL(WatchAppLink.dictate.url)
                .accessibilityLabel("Dictate a message")
        }.configurationDisplayName("Dictate").description("Dictate into a draft, then send manually.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchVoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.voice", provider: WatchProvider()) { _ in
            WatchGlyph(kind: .voice).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle())
                .containerBackground(.black, for: .widget).widgetURL(WatchAppLink.voice.url)
                .accessibilityLabel("Start or resume voice")
        }.configurationDisplayName("Voice Session").description("Start or resume a spoken conversation.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchNutritionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.nutrition", provider: WatchProvider()) { entry in
            WatchComplicationWithAge(date: entry.dashboardStale ? entry.dashboard?.generatedAt : nil) {
                WatchNutritionComplicationView(entry: entry)
            }.containerBackground(.black, for: .widget)
                .widgetURL(WatchAppLink.nutrition.url)
        }.configurationDisplayName("Nutrition").description("Today's carbohydrates, fat and protein against your saved goals.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.home", provider: WatchProvider()) { entry in
            WatchComplicationWithAge(date: entry.dashboard?.brief.flatMap { $0.isCurrent(at: entry.date) ? nil : $0.generatedAt }) {
                WatchHomeComplicationView(entry: entry)
            }.containerBackground(.black, for: .widget)
                .widgetURL(WatchAppLink.home.url)
        }.configurationDisplayName("Home").description("A short highlight from your iPhone Home brief.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchTaskListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.task-list", provider: WatchProvider()) { entry in
            WatchComplicationWithAge(date: entry.dashboard?.todayTasks != nil
                                     ? (entry.dashboardStale ? entry.dashboard?.generatedAt : nil)
                                     : (!entry.current ? entry.health?.generatedAt : nil)) {
                WatchTasksComplicationView(entry: entry)
            }.containerBackground(.black, for: .widget)
                .widgetURL(WatchAppLink.tasks.url)
        }.configurationDisplayName("Tasks").description("Actual task titles due today, including overdue tasks.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchBodyFatWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.body-fat", provider: WatchProvider()) { entry in
            WatchComplicationWithAge(date: entry.dashboardStale ? entry.dashboard?.generatedAt : nil) {
                WatchBodyFatComplicationView(entry: entry)
            }.containerBackground(.black, for: .widget)
                .widgetURL(WatchAppLink.bodyFat.url)
        }.configurationDisplayName("Body Fat").description("Your latest body fat percentage and three-month trend.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchLogLiftWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.logLift", provider: WatchProvider()) { _ in
            WatchLogLiftComplicationView()
                .containerBackground(.black, for: .widget).widgetURL(WatchAppLink.logLift.url)
        }.configurationDisplayName("Log lift").description("Type or dictate a lift, then save explicitly.")
            .supportedFamilies([.accessoryCircular])
    }
}
@main
struct JarvisWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        JarvisWatchHealthWidget()
        JarvisWatchTasksWidget()
        JarvisWatchDictateWidget()
        JarvisWatchVoiceWidget()
        JarvisWatchNutritionWidget()
        JarvisWatchHomeWidget()
        JarvisWatchTaskListWidget()
        JarvisWatchBodyFatWidget()
        JarvisWatchLogLiftWidget()
    }
}
