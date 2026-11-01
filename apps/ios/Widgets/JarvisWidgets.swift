import ActivityKit
import JarvisCore
import SwiftUI
import UIKit
import WidgetKit

@main
struct JarvisWidgets: WidgetBundle {
    var body: some Widget {
        JarvisFactoryLiveActivityWidget()
    }
}

struct JarvisFactoryLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FactoryTaskActivityAttributes.self) { context in
            LockScreenFactoryTaskActivity(context: context)
        } dynamicIsland: { _ in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    EmptyView()
                }
            } compactLeading: {
                EmptyView()
            } compactTrailing: {
                EmptyView()
            } minimal: {
                EmptyView()
            }
        }
    }
}

private struct LockScreenFactoryTaskActivity: View {
    let context: ActivityViewContext<FactoryTaskActivityAttributes>

    private var language: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: context.attributes.language) ?? .default
    }

    var body: some View {
        FactoryTaskActivitySurface(
            factoryTitle: context.attributes.factoryTitle,
            state: context.state.state,
            activity: context.state.activity,
            startedAt: context.attributes.startedAt,
            language: language
        )
        .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
        .activitySystemActionForegroundColor(.orange)
    }
}
