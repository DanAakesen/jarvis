import ActivityKit
import SwiftUI
import WidgetKit

struct CarScheduleActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CarScheduleActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 3) {
                Label(context.state.title, systemImage: "calendar").font(.headline).lineLimit(2)
                HStack {
                    Text(context.state.starts, style: .date)
                    Text(context.state.starts, style: .time)
                }.font(.subheadline)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    Label(context.state.title, systemImage: "calendar").lineLimit(2)
                }
                DynamicIslandExpandedRegion(.bottom) { Text(context.state.starts, style: .time) }
            } compactLeading: {
                Image(systemName: "calendar")
            } compactTrailing: {
                Text(context.state.starts, style: .time)
            } minimal: {
                Image(systemName: "calendar")
            }
        }
        .supplementalActivityFamilies([.small])
    }
}
