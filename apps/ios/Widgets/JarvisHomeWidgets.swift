import JarvisCore
import SwiftUI
import WidgetKit

/// The eight Gym and Factory home screen widgets. No controls, no Live Activity changes. Each refreshes on the
/// scheduled timeline from `JarvisHomeWidgetProvider`; nothing animates, so Reduce Motion needs no special case.
private func homeWidget<Content: View>(
    _ kind: JarvisWidgetKind,
    name: JarvisWidgetCopy,
    family: WidgetFamily,
    @ViewBuilder view: @escaping (JarvisWidgetEntry) -> Content
) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind.rawValue, provider: JarvisHomeWidgetProvider(topic: kind.topic)) { entry in
        view(entry)
    }
    .configurationDisplayName(name.text(language: .default))
    .supportedFamilies([family])
    .contentMarginsDisabled()
}

struct JarvisGymStepsWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.gymSteps, name: .steps, family: .systemSmall) { JarvisGymStepsWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisGymWorkoutsWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.gymWorkouts, name: .workouts, family: .systemSmall) { JarvisGymWorkoutsWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisGymMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.gymMedium, name: .displayNameGym, family: .systemMedium) { JarvisGymMediumWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisGymLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.gymLarge, name: .displayNameGym, family: .systemLarge) { JarvisGymLargeWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisFactoryStatusWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.factoryStatus, name: .factory, family: .systemSmall) { JarvisFactoryStatusWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisFactoryDoneWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.factoryDone, name: .done, family: .systemSmall) { JarvisFactoryDoneWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisFactoryMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.factoryMedium, name: .factory, family: .systemMedium) { JarvisFactoryMediumWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisFactoryLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.factoryLarge, name: .softwareFactory, family: .systemLarge) { JarvisFactoryLargeWidgetView(entry: $0).padding(16) }
    }
}
