import JarvisCore
import SwiftUI
import WidgetKit

/// Every size in every state the widgets support: content, stale, loading, empty, error and offline, in Danish and
/// English. Step through each preview's timeline in Xcode; tinted and Liquid Glass rendering come from the preview's
/// rendering-mode controls.
private enum PreviewStates {
    static var gym: [JarvisWidgetEntry] {
        [
            JarvisWidgetSamples.entry(),
            JarvisWidgetSamples.entry(language: .en),
            JarvisWidgetSamples.entry(gym: .content(JarvisWidgetSamples.gym, isStale: true)),
            JarvisWidgetSamples.entry(gym: .loading),
            JarvisWidgetSamples.entry(gym: .empty),
            JarvisWidgetSamples.entry(gym: .error),
            JarvisWidgetSamples.entry(gym: .offline),
        ]
    }

    static var factory: [JarvisWidgetEntry] {
        [
            JarvisWidgetSamples.entry(),
            JarvisWidgetSamples.entry(language: .en),
            JarvisWidgetSamples.entry(factory: .content(JarvisWidgetSamples.factory(), isStale: true)),
            JarvisWidgetSamples.entry(factory: .loading),
            JarvisWidgetSamples.entry(factory: .empty),
            JarvisWidgetSamples.entry(factory: .error),
            JarvisWidgetSamples.entry(factory: .offline),
        ]
    }

    /// Notes: live in Danish and English, a task-less day (the empty-phrase case with a note), stale, loading,
    /// empty, error and offline.
    static var notes: [JarvisWidgetEntry] {
        let quiet = JarvisNotesWidgetData(
            generatedAt: JarvisWidgetSamples.now, tasksToday: 0, tasks: [], notes: JarvisWidgetSamples.notes().notes
        )
        return [
            JarvisWidgetSamples.entry(),
            JarvisWidgetSamples.entry(language: .en),
            JarvisWidgetSamples.entry(notes: .content(JarvisWidgetSamples.notes(), isStale: true)),
            JarvisWidgetSamples.entry(notes: .content(quiet, isStale: false)),
            JarvisWidgetSamples.entry(notes: .loading),
            JarvisWidgetSamples.entry(notes: .empty),
            JarvisWidgetSamples.entry(notes: .error),
            JarvisWidgetSamples.entry(notes: .offline),
        ]
    }

    /// Home: live in Danish and English, all quiet, stale, loading, error and offline (Home is never empty).
    static var home: [JarvisWidgetEntry] {
        let quiet = JarvisHomeWidgetData(generatedAt: JarvisWidgetSamples.now, approvals: 0, running: 0)
        return [
            JarvisWidgetSamples.entry(),
            JarvisWidgetSamples.entry(language: .en),
            JarvisWidgetSamples.entry(home: .content(quiet, isStale: false)),
            JarvisWidgetSamples.entry(home: .content(JarvisWidgetSamples.home, isStale: true)),
            JarvisWidgetSamples.entry(home: .loading),
            JarvisWidgetSamples.entry(home: .error),
            JarvisWidgetSamples.entry(home: .offline),
        ]
    }
}

/// The `#Preview` timeline closure is a result builder that takes one entry per expression, so each state is listed
/// as its own expression (an array expression does not conform to `TimelineEntry`).
#Preview("Gym steps", as: .systemSmall) { JarvisGymStepsWidget() } timeline: {
    PreviewStates.gym[0]
    PreviewStates.gym[1]
    PreviewStates.gym[2]
    PreviewStates.gym[3]
    PreviewStates.gym[4]
    PreviewStates.gym[5]
    PreviewStates.gym[6]
}

#Preview("Gym workouts", as: .systemSmall) { JarvisGymWorkoutsWidget() } timeline: {
    PreviewStates.gym[0]
    PreviewStates.gym[1]
    PreviewStates.gym[2]
    PreviewStates.gym[3]
    PreviewStates.gym[4]
    PreviewStates.gym[5]
    PreviewStates.gym[6]
}

#Preview("Gym medium", as: .systemMedium) { JarvisGymMediumWidget() } timeline: {
    PreviewStates.gym[0]
    PreviewStates.gym[1]
    PreviewStates.gym[2]
    PreviewStates.gym[3]
    PreviewStates.gym[4]
    PreviewStates.gym[5]
    PreviewStates.gym[6]
}

#Preview("Gym large", as: .systemLarge) { JarvisGymLargeWidget() } timeline: {
    PreviewStates.gym[0]
    PreviewStates.gym[1]
    PreviewStates.gym[2]
    PreviewStates.gym[3]
    PreviewStates.gym[4]
    PreviewStates.gym[5]
    PreviewStates.gym[6]
}

#Preview("Factory status", as: .systemSmall) { JarvisFactoryStatusWidget() } timeline: {
    PreviewStates.factory[0]
    PreviewStates.factory[1]
    PreviewStates.factory[2]
    PreviewStates.factory[3]
    PreviewStates.factory[4]
    PreviewStates.factory[5]
    PreviewStates.factory[6]
}

#Preview("Factory done", as: .systemSmall) { JarvisFactoryDoneWidget() } timeline: {
    PreviewStates.factory[0]
    PreviewStates.factory[1]
    PreviewStates.factory[2]
    PreviewStates.factory[3]
    PreviewStates.factory[4]
    PreviewStates.factory[5]
    PreviewStates.factory[6]
}

#Preview("Factory medium", as: .systemMedium) { JarvisFactoryMediumWidget() } timeline: {
    PreviewStates.factory[0]
    PreviewStates.factory[1]
    PreviewStates.factory[2]
    PreviewStates.factory[3]
    PreviewStates.factory[4]
    PreviewStates.factory[5]
    PreviewStates.factory[6]
}

#Preview("Factory large", as: .systemLarge) { JarvisFactoryLargeWidget() } timeline: {
    PreviewStates.factory[0]
    PreviewStates.factory[1]
    PreviewStates.factory[2]
    PreviewStates.factory[3]
    PreviewStates.factory[4]
    PreviewStates.factory[5]
    PreviewStates.factory[6]
}

#Preview("Notes small", as: .systemSmall) { JarvisNotesSmallWidget() } timeline: {
    PreviewStates.notes[0]
    PreviewStates.notes[1]
    PreviewStates.notes[2]
    PreviewStates.notes[3]
    PreviewStates.notes[4]
    PreviewStates.notes[5]
    PreviewStates.notes[6]
    PreviewStates.notes[7]
}

#Preview("Notes medium", as: .systemMedium) { JarvisNotesMediumWidget() } timeline: {
    PreviewStates.notes[0]
    PreviewStates.notes[1]
    PreviewStates.notes[2]
    PreviewStates.notes[3]
    PreviewStates.notes[4]
    PreviewStates.notes[5]
    PreviewStates.notes[6]
    PreviewStates.notes[7]
}

#Preview("Notes large", as: .systemLarge) { JarvisNotesLargeWidget() } timeline: {
    PreviewStates.notes[0]
    PreviewStates.notes[1]
    PreviewStates.notes[2]
    PreviewStates.notes[3]
    PreviewStates.notes[4]
    PreviewStates.notes[5]
    PreviewStates.notes[6]
    PreviewStates.notes[7]
}

#Preview("Home small", as: .systemSmall) { JarvisHomeSmallWidget() } timeline: {
    PreviewStates.home[0]
    PreviewStates.home[1]
    PreviewStates.home[2]
    PreviewStates.home[3]
    PreviewStates.home[4]
    PreviewStates.home[5]
    PreviewStates.home[6]
}

#Preview("Home medium", as: .systemMedium) { JarvisHomeMediumWidget() } timeline: {
    PreviewStates.home[0]
    PreviewStates.home[1]
    PreviewStates.home[2]
    PreviewStates.home[3]
    PreviewStates.home[4]
    PreviewStates.home[5]
    PreviewStates.home[6]
}

#Preview("Home large", as: .systemLarge) { JarvisHomeLargeWidget() } timeline: {
    PreviewStates.home[0]
    PreviewStates.home[1]
    PreviewStates.home[2]
    PreviewStates.home[3]
    PreviewStates.home[4]
    PreviewStates.home[5]
    PreviewStates.home[6]
}
