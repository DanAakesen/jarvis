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
