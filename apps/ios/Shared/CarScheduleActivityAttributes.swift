import ActivityKit
import Foundation

struct CarScheduleActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let starts: Date
        let ends: Date
    }

    let eventID: String

    static func stopTracking() async {
        for activity in Activity<Self>.activities { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
