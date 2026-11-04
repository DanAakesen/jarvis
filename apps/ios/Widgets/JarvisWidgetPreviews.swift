import JarvisCore
import SwiftUI
import WidgetKit

/// Every size in every state the widgets support: content, stale, loading, empty, error and offline, in Danish and
/// English. Step through each preview's timeline in Xcode; tinted and Liquid Glass rendering come from the preview's
/// rendering-mode controls.
private enum PreviewStates {
    static func gym() -> [JarvisWidgetEntry] {
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

    static func factory() -> [JarvisWidgetEntry] {
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

#Preview("Gym steps", as: .systemSmall) { JarvisGymStepsWidget() } timeline: { PreviewStates.gym() }
#Preview("Gym workouts", as: .systemSmall) { JarvisGymWorkoutsWidget() } timeline: { PreviewStates.gym() }
#Preview("Gym medium", as: .systemMedium) { JarvisGymMediumWidget() } timeline: { PreviewStates.gym() }
#Preview("Gym large", as: .systemLarge) { JarvisGymLargeWidget() } timeline: { PreviewStates.gym() }
#Preview("Factory status", as: .systemSmall) { JarvisFactoryStatusWidget() } timeline: { PreviewStates.factory() }
#Preview("Factory done", as: .systemSmall) { JarvisFactoryDoneWidget() } timeline: { PreviewStates.factory() }
#Preview("Factory medium", as: .systemMedium) { JarvisFactoryMediumWidget() } timeline: { PreviewStates.factory() }
#Preview("Factory large", as: .systemLarge) { JarvisFactoryLargeWidget() } timeline: { PreviewStates.factory() }
