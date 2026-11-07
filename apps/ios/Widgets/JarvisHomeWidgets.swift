import JarvisCore
import SwiftUI
import WidgetKit

/// The Gym, Factory, Notes and Home home screen widgets. No controls, no Live Activity changes; the Notes and Home
/// widgets have no buttons at all and open the matching page when tapped. Each refreshes on the
/// scheduled timeline from `JarvisHomeWidgetProvider`; nothing animates, so Reduce Motion needs no special case.
private func homeWidget<Content: View>(
    _ kind: JarvisWidgetKind,
    name: JarvisWidgetCopy,
    family: WidgetFamily,
    @ViewBuilder view: @escaping (JarvisWidgetEntry) -> Content
) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind.rawValue, provider: JarvisHomeWidgetProvider(topic: kind.topic)) { entry in
        view(entry)
            .widgetURL(JarvisWidgetLink.url(for: kind.topic))
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

struct JarvisNotesSmallWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.notesSmall, name: .tasks, family: .systemSmall) { JarvisNotesSmallWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisNotesMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.notesMedium, name: .tasks, family: .systemMedium) { JarvisNotesMediumWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisNotesLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.notesLarge, name: .tasks, family: .systemLarge) { JarvisNotesLargeWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisHomeSmallWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.homeSmall, name: .displayNameHome, family: .systemSmall) { JarvisHomeSmallWidgetView(entry: $0).padding(14) }
    }
}

struct JarvisHomeMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.homeMedium, name: .displayNameHome, family: .systemMedium) { JarvisHomeMediumWidgetView(entry: $0).padding(16) }
    }
}

struct JarvisHomeLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeWidget(.homeLarge, name: .displayNameHome, family: .systemLarge) { JarvisHomeLargeWidgetView(entry: $0).padding(16) }
    }
}
