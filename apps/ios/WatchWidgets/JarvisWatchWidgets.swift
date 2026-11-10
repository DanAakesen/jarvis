import JarvisCore
import SwiftUI
import WidgetKit

struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry { .init(date: Date(), health: nil, current: false) }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let value = entry()
        // Expire display data on its actual deadline even if no companion refresh arrives.
        let expiry = value.health?.expiresAt() ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [value, .init(date: max(expiry, Date().addingTimeInterval(1)), health: nil, current: false)], policy: .after(Date().addingTimeInterval(900))))
    }
    private func entry() -> WatchEntry {
        let defaults = UserDefaults(suiteName: "group.com.danaakesen.jarvis")
        let snapshot = defaults?.data(forKey: "watch.health").flatMap { try? JSONDecoder().decode(WatchHealthSnapshot.self, from: $0) }
        let current = snapshot?.isCurrent(at: Date()) == true
        return .init(date: Date(), health: current ? snapshot : nil, current: current)
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
struct JarvisWatchLogLiftWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "jarvis.watch.logLift", provider: WatchProvider()) { _ in
            WatchLogLiftComplicationView()
                .containerBackground(.black, for: .widget).widgetURL(URL(string: "jarvis-watch://log-lift"))
        }.configurationDisplayName("Log lift").description("Type or dictate a lift, then save explicitly.")
            .supportedFamilies([.accessoryCircular])
    }
}
@main
struct JarvisWatchWidgetBundle: WidgetBundle {
    var body: some Widget { JarvisWatchHealthWidget(); JarvisWatchTasksWidget(); JarvisWatchDictateWidget(); JarvisWatchVoiceWidget(); JarvisWatchLogLiftWidget() }
}
