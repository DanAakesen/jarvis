import JarvisCore
import SwiftUI
import WidgetKit

struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry { .init(date: Date(), health: nil, current: false) }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let value = entry()
        // Expire display data on its actual deadline even if no companion refresh arrives.
        let expiries = [value.health?.expiresAt(), value.dashboard?.expiresAt(),
                        value.dashboard?.brief?.generatedAt.addingTimeInterval(900)]
            .compactMap { $0 }.filter { $0 > value.date }.sorted()
        let entries = [value] + Array(Set(expiries)).sorted().map { entry(at: $0) }
        completion(Timeline(entries: entries, policy: .after(value.date.addingTimeInterval(900))))
    }
    private func entry(at date: Date = Date()) -> WatchEntry {
        let defaults = UserDefaults(suiteName: "group.com.danaakesen.jarvis")
        let snapshot = defaults?.data(forKey: "watch.health").flatMap { try? JSONDecoder().decode(WatchHealthSnapshot.self, from: $0) }
        let dashboard = defaults?.data(forKey: "watch.dashboard").flatMap { try? JSONDecoder().decode(WatchDashboardSnapshot.self, from: $0) }
        let current = snapshot?.isCurrent(at: date) == true
        return .init(date: date, health: current ? snapshot : nil, current: current,
                     dashboard: dashboard?.isCurrent(at: date) == true ? dashboard : nil,
                     dashboardStale: dashboard != nil && dashboard?.isCurrent(at: date) != true)
    }
}

struct JarvisWatchHealthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.health", provider: WatchProvider()) { entry in
            WatchHealthView(entry: entry).privacySensitive().containerBackground(.black, for: .widget).widgetURL(URL(string: "jarvis-watch://health"))
        }.configurationDisplayName("Daily steps").description("Daily steps and progress toward your goal from iPhone.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchTasksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.tasks", provider: WatchProvider()) { entry in
            HStack(spacing: 5) {
                WatchGlyph(kind: .tasks).frame(width: 16, height: 20)
                Text(entry.health?.tasksToday.map(String.init) ?? "—").font(.system(size: 25, weight: .semibold, design: .rounded)).minimumScaleFactor(0.5)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle()).containerBackground(.black, for: .widget)
                .privacySensitive().widgetURL(URL(string: "jarvis-watch://tasks"))
                .accessibilityLabel(entry.health?.tasksToday.map { "\($0) tasks due today" } ?? "Today's tasks unavailable")
        }.configurationDisplayName("Tasks Today").description("Remaining tasks due today.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchDictateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.dictate", provider: WatchProvider()) { _ in
            WatchGlyph(kind: .dictate).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle())
                .containerBackground(.black, for: .widget).widgetURL(URL(string: "jarvis-watch://dictate"))
                .accessibilityLabel("Dictate a message")
        }.configurationDisplayName("Dictate").description("Dictate into a draft, then send manually.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchVoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.voice", provider: WatchProvider()) { _ in
            WatchGlyph(kind: .voice).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity).modifier(WatchSurface(radius: 50)).clipShape(Circle())
                .containerBackground(.black, for: .widget).widgetURL(URL(string: "jarvis-watch://voice"))
                .accessibilityLabel("Start or resume voice")
        }.configurationDisplayName("Voice Session").description("Start or resume a spoken conversation.").supportedFamilies([.accessoryCircular])
    }
}
struct JarvisWatchNutritionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.nutrition", provider: WatchProvider()) { entry in
            WatchNutritionComplicationView(entry: entry)
                .privacySensitive().containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "jarvis-watch://nutrition"))
        }.configurationDisplayName("Nutrition").description("Today's carbohydrates, fat and protein against your saved goals.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.home", provider: WatchProvider()) { entry in
            WatchHomeComplicationView(entry: entry)
                .privacySensitive().containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "jarvis-watch://home"))
        }.configurationDisplayName("Home").description("A short highlight from your iPhone Home brief.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchTaskListWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.task-list", provider: WatchProvider()) { entry in
            WatchTasksComplicationView(entry: entry)
                .privacySensitive().containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "jarvis-watch://tasks"))
        }.configurationDisplayName("Tasks").description("Actual task titles due today, including overdue tasks.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
    }
}
struct JarvisWatchBodyFatWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.body-fat", provider: WatchProvider()) { entry in
            WatchBodyFatComplicationView(entry: entry)
                .privacySensitive().containerBackground(.black, for: .widget)
                .widgetURL(URL(string: "jarvis-watch://body-fat"))
        }.configurationDisplayName("Body Fat").description("Your latest body fat percentage and up to 20 measurements.")
            .supportedFamilies([.accessoryRectangular]).contentMarginsDisabled()
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
    }
}
