import JarvisCore
import WidgetKit

extension JarvisWidgetEntry: TimelineEntry {}

/// One scheduled timeline per topic, read from the App Group snapshot. The plan (entries, the moment a section
/// turns stale, the next reload) is `JarvisWidgetTimeline`, which the package tests cover.
struct JarvisHomeWidgetProvider: TimelineProvider {
    let topic: JarvisWidgetTopic

    func placeholder(in context: Context) -> JarvisWidgetEntry {
        JarvisWidgetSamples.entry()
    }

    func getSnapshot(in context: Context, completion: @escaping (JarvisWidgetEntry) -> Void) {
        if context.isPreview {
            completion(JarvisWidgetSamples.entry())
        } else {
            completion(plan(now: Date()).entries[0])
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<JarvisWidgetEntry>) -> Void) {
        let plan = plan(now: Date())
        completion(Timeline(entries: plan.entries, policy: .after(plan.reloadAfter)))
    }

    private func plan(now: Date) -> JarvisWidgetTimelinePlan {
        let load = JarvisWidgetSnapshotStore.appGroup()?.load() ?? .missing
        return JarvisWidgetTimeline.plan(for: load, topic: topic, now: now)
    }
}
