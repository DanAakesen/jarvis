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
    private static var personalTasks = taskFixtures()
    private static var personalSubmissions: [UUID: Data] = [:]
    static func project() throws -> FactoryProject {
        try JSONDecoder().decode(FactoryProject.self, from: Data(#"{"id":"7","name":"Fixture project","repo":"example/fixture","default_branch":"main","default_agent":"codex","policy":"deliver_pr"}"#.utf8))
    }
    static func dashboard() -> WatchDashboardSnapshot {
        let now = Date()
        var value = WatchDashboardSnapshot(now: now)
        value.agenda = [
            .init(id: "fixture-meeting", title: "Design review", start: now.addingTimeInterval(1800),
                  end: now.addingTimeInterval(3600), location: "Studio")
        ]
        let calendar = Calendar.current
        value.bodyFat = (0..<20).compactMap { index in
            guard let date = calendar.date(byAdding: .day, value: index - 19, to: now) else { return nil }
            return .init(date: JarvisTodayTaskLists.dayKey(date, calendar: calendar), percent: 18.5 - Double(index) * 0.025)
        }
        let taskGroups = JarvisTodayTaskLists(tasks: personalTasks, now: now)
        value.todayTasks = .init(tasks: taskGroups.today)
        value.upcomingTasks = .init(tasks: taskGroups.upcoming)
        value.notes = [.init(path: "Personal/design-review.md", title: "Design review", folder: "Personal",
                             directory: "Personal", updatedAt: ISO8601DateFormatter().string(from: now))]
        value.nutrition = .init(date: JarvisTodayTaskLists.dayKey(now), carbsGrams: 135, fatGrams: 42, proteinGrams: 86,
                                carbsGoalGrams: 250, fatGoalGrams: 70, proteinGoalGrams: 130)
        value.brief = .init(text: "Your design review starts soon. Bring your notes.",
                           highlights: ["design review"], generatedAt: now)
        value.sourceUpdatedAt["notes"] = now
        return value
    }
    static func reply(to request: WatchRequest) throws -> WatchReply {
        func encoded<T: Encodable>(_ value: T) throws -> WatchReply {
            .init(id: request.id, data: try WatchCodec.encode(value))
        }
        switch request.action {
        case .tasks:
            let open = personalTasks.filter { !$0.done }
            if let id = request.itemID { return try encoded(open.first { $0.id == id }) }
            guard let data = request.data else { return try encoded(open) }
            let page = try JSONDecoder().decode(WatchPageRequest.self, from: data)
            guard page.isValid, page.offset <= open.count else { throw WatchFailure.invalidRequest }
            let tasks = Array(open.dropFirst(page.offset).prefix(20))
            let next = page.offset + tasks.count
            return try encoded(WatchTaskPage(tasks: tasks, totalCount: open.count, offset: page.offset,
                nextOffset: next < open.count ? next : nil, dayStart: Calendar.current.startOfDay(for: Date()),
                timeZoneID: TimeZone.current.identifier))
        case .createWatchTask:
            guard let value = request.createWatchTaskRequest, let payload = request.data else { throw WatchFailure.invalidRequest }
            if let previous = created[request.id] {
                guard personalSubmissions[request.id] == payload else { throw WatchFailure.invalidRequest }
                return previous
            }
            if ProcessInfo.processInfo.arguments.contains("--watch-task-failure=parse") {
                return .init(id: request.id, taskError: .init(code: "task_parse_failed",
                    message: "The task could not be understood. Try different wording or use Manual.",
                    retryable: false, outcomeUnknown: false))
            }
            if ProcessInfo.processInfo.arguments.contains("--watch-task-failure=save") {
                return .init(id: request.id, taskError: .unknown)
            }
            let fields = value.fields
            let submitted = ISO8601DateFormatter().date(from: value.submittedAt) ?? Date()
            let due = submitted.addingTimeInterval(3_600)
            var calendar = Calendar.current
            calendar.timeZone = TimeZone(identifier: value.timeZone) ?? .current
            let parts = calendar.dateComponents([.hour, .minute], from: due)
            let dueDate = fields?.due ?? (value.mode == .auto ? JarvisTodayTaskLists.dayKey(due, calendar: calendar) : nil)
            let dueTime = fields?.time ?? (value.mode == .auto ? String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0) : nil)
            let task = VaultTask(id: String(repeating: "e", count: 64), text: fields?.text ?? "Call dentist",
                done: false, dueDate: dueDate, dueTime: dueTime,
                dueAt: value.mode == .auto ? ISO8601DateFormatter().string(from: due) : nil,
                priority: fields?.priority ?? .normal,
                path: fields?.scope == .work ? "Work/Inbox.md" : "Personal/Inbox.md",
                line: 12, heading: "Tasks", version: String(repeating: "e", count: 64),
                notes: fields?.notes ?? "Ask about the next check-up.", timeZone: value.timeZone, remindAtDue: false)
            personalTasks.append(task)
            let reply = try encoded(task); created[request.id] = reply; personalSubmissions[request.id] = payload
            return reply
        case .updateWatchTask:
            guard let value = request.updateWatchTaskRequest,
                  let previous = personalTasks.first(where: { $0.id == request.itemID }),
                  previous.path == value.path, previous.line == value.line,
                  previous.text == value.text, previous.version == value.version else {
                return .init(id: request.id, taskError: .init(code: "task_conflict",
                    message: "This task changed in the vault. Refresh the list.", retryable: false, outcomeUnknown: false))
            }
            let task = VaultTask(id: previous.id, text: value.fields.text, done: previous.done,
                dueDate: value.fields.due, dueTime: value.fields.time, dueAt: nil,
                priority: value.fields.priority, path: previous.path, line: previous.line,
                heading: previous.heading, version: String(repeating: "f", count: 64),
                notes: value.fields.notes, timeZone: value.timeZone, remindAtDue: value.fields.remindAtDue)
            personalTasks.removeAll { $0.id == task.id }; personalTasks.append(task)
            return try encoded(task)
        case .completeWatchTask:
            guard let task = request.completionWatchTask,
                  let previous = personalTasks.first(where: { $0.id == task.id }),
                  previous.version == task.version else { throw WatchFailure.invalidRequest }
            personalTasks.removeAll { $0.id == task.id }
            let json: [String: Any] = ["id": task.id, "path": task.path, "line": task.line,
                                      "done": request.flag == true, "version": String(repeating: "f", count: 64)]
            return .init(id: request.id, data: try JSONSerialization.data(withJSONObject: json))
        case .dashboard: return try encoded(dashboard())
        case .brief: return try encoded(dashboard().brief!)
        case .agenda: return try encoded(WatchAgendaPage(entries: dashboard().agenda ?? [], offset: 0, nextOffset: nil))
        case .bodyFat: return try encoded(dashboard().bodyFat ?? [])
        case .nutrition: return try encoded(dashboard().nutrition!)
        case .notes: return try encoded(WatchNotesPage(notes: dashboard().notes ?? [], offset: 0, nextOffset: nil))
        case .note:
            return try encoded(WatchNoteDetail(path: request.text ?? request.itemID ?? "Personal/design-review.md",
                                                content: "# Design review\n\nSynthetic preview notes for the design review.",
                                                revision: String(repeating: "a", count: 40), offset: 0, nextOffset: nil))
        case .projects: return try encoded([project()])
        case .factoryTasks: return try encoded(factoryTasks)
        case .lifts: return try encoded(lifts)
        case .workouts: return try encoded([[String: JSONValue]]())
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
    private static func taskFixtures() -> [VaultTask] {
        let now = Date(); let calendar = Calendar.current
        func task(_ key: String, _ text: String, days: Int, time: String, priority: VaultTask.Priority, notes: String? = nil) -> VaultTask {
            let date = calendar.date(byAdding: .day, value: days, to: now) ?? now
            return .init(id: String(repeating: key, count: 64), text: text, done: false,
                dueDate: JarvisTodayTaskLists.dayKey(date), dueTime: time, dueAt: nil,
                priority: priority, path: "Personal/Inbox.md", line: days + 5, heading: "Tasks",
                version: String(repeating: key, count: 64), notes: notes,
                timeZone: "Europe/Copenhagen", remindAtDue: false)
        }
        return [
            task("a", "Call dentist", days: 0, time: "17:00", priority: .normal, notes: "Ask about the next check-up."),
            task("b", "Pick up parcel", days: 0, time: "18:00", priority: .medium),
            task("c", "Pay phone bill", days: -1, time: "12:00", priority: .high),
            task("d", "Plan the weekend", days: 2, time: "10:00", priority: .normal)
        ]
    }
}
#endif
