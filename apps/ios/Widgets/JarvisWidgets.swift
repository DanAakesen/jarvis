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
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    LockScreenFactoryTaskActivity(context: context)
                }
            } compactLeading: {
                Image(systemName: symbol(for: context.state.phase))
                    .accessibilityLabel(context.attributes.title)
            } compactTrailing: {
                Text(context.state.state)
                    .font(.caption2)
                    .lineLimit(1)
                    .accessibilityLabel(context.state.state)
            } minimal: {
                Image(systemName: symbol(for: context.state.phase))
                    .accessibilityLabel("\(context.attributes.title), \(context.state.state)")
            }
        }
    }

    private func symbol(for phase: String?) -> String {
        switch phase {
        case "waiting": "pause.circle"
        case "done": "checkmark.circle"
        case "failed": "exclamationmark.triangle"
        case "cancelled": "xmark.circle"
        default: "chevron.left.forwardslash.chevron.right"
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
            language: language,
            taskTitle: context.attributes.title,
            phase: context.state.phase,
            isStale: context.isStale
        )
        .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
        .activitySystemActionForegroundColor(.orange)
    }
}
