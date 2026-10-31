import ActivityKit
import Foundation

struct FactoryTaskActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var state: String
        var activity: String?
    }

    var taskID: String
    var title: String
    var startedAt: Date?
    var language: String
    var factoryTitle: String
}
