import ActivityKit
import Foundation

struct CarScheduleActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let starts: Date
        let ends: Date
    }

    let eventID: String

    static func clearActivities(expiredOnly: Bool = false) {
        let activities = Activity<Self>.activities.filter { !expiredOnly || $0.content.state.ends <= Date() }
        Task {
            for activity in activities { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
