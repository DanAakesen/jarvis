#if DEBUG
import Foundation
import JarvisCore

/// Isolated synthetic previews. No fixture request reaches WatchConnectivity or a live Factory.
@MainActor enum WatchPreview {
    private static var lifts: [[String: JSONValue]] = [
        ["id": .string("00000000-0000-4000-8000-000000000001"), "exerciseName": .string("Bench press"),
         "weightKg": .number(60), "reps": .number(8), "sets": .number(3)]
    ]
    private static var factoryTasks: [WatchFactoryTask] = []
    private static var created: [UUID: WatchReply] = [:]
    static func project() throws -> FactoryProject {
        try JSONDecoder().decode(FactoryProject.self, from: Data(#"{"id":"7","name":"Fixture project","repo":"example/fixture","default_branch":"main","default_agent":"codex","policy":"deliver_pr"}"#.utf8))
    }
    static func reply(to request: WatchRequest) throws -> WatchReply {
        func encoded<T: Encodable>(_ value: T) throws -> WatchReply {
            .init(id: request.id, data: try WatchCodec.encode(value))
        }
        switch request.action {
        case .projects: return try encoded([project()])
        case .factoryTasks: return try encoded(factoryTasks)
        case .lifts: return try encoded(lifts)
        case .workouts: return try encoded([[String: JSONValue]]())
        case .captureLift:
            guard let capture = request.liftCapture else { throw WatchFailure.invalidRequest }
            return try encoded(WatchLiftCaptureFixture.result(for: capture))
        case .createFactoryTask:
            if let previous = created[request.id] { return previous }
            guard let value = request.factorySubmission else { throw WatchFailure.invalidRequest }
            let data = try JSONSerialization.data(withJSONObject: ["id": String(factoryTasks.count + 1),
                "title": value.title, "state": "Ready", "request": value.request])
            let task = try JSONDecoder().decode(WatchFactoryTask.self, from: data)
            factoryTasks.insert(task, at: 0)
            let result = try encoded(task); created[request.id] = result
            return result
        case .saveLift:
            if let previous = created[request.id] { return previous }
            guard let data = request.data, let value = try? JSONDecoder().decode(WatchLiftInput.self, from: data), value.isValid else { throw WatchFailure.invalidRequest }
            let id = request.itemID ?? value.submissionID.uuidString
            lifts.removeAll { $0["id"] == .string(id) }
            lifts.insert(["id": .string(id), "exerciseName": .string(value.exercise),
                "weightKg": .number(value.kilograms), "reps": .number(Double(value.reps)), "sets": .number(Double(value.sets))], at: 0)
            let reply = WatchReply(id: request.id); created[request.id] = reply
            return reply
        case .deleteLift:
            lifts.removeAll { $0["id"] == request.itemID.map(JSONValue.string) }
            return WatchReply(id: request.id)
        default: throw WatchFailure.unavailable
        }
    }
}
#endif
