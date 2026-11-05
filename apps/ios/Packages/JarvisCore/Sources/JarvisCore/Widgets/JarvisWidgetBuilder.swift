import Foundation

/// A logged workout the Gym widgets count: a lift session or a run.
public struct JarvisWidgetWorkout: Equatable, Sendable {
    public enum Kind: Sendable {
        case lift, run
    }

    public let date: Date
    public let kind: Kind
    public let kilometers: Double
    public let calories: Double

    public init(date: Date, kind: Kind, kilometers: Double = 0, calories: Double = 0) {
        self.date = date
        self.kind = kind
        self.kilometers = kilometers
        self.calories = calories
    }
}

/// Pure mapping from what the app knows (HealthKit, the Factory API) to the widget snapshot sections.
public enum JarvisWidgetBuilder {
    public static func gym(
        now: Date,
        calendar: Calendar,
        dailySteps: [Date: Int],
        workouts: [JarvisWidgetWorkout],
        stepGoal: Int,
        liftTarget: Int,
        runTarget: Int
    ) -> JarvisGymWidgetData {
        let today = calendar.startOfDay(for: now)
        let days = (0..<JarvisWidgetSnapshot.days).reversed().compactMap { calendar.date(byAdding: .day, value: -$0, to: today) }
        let weekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? today
        let thisWeek = workouts.filter { $0.date >= weekStart && $0.date <= now }
        let weeks: [JarvisGymWidgetData.Week] = (0..<JarvisWidgetSnapshot.days).reversed().compactMap { back in
            guard let start = calendar.date(byAdding: .weekOfYear, value: -back, to: weekStart),
                  let end = calendar.date(byAdding: .weekOfYear, value: 1, to: start) else { return nil }
            let inWeek = workouts.filter { $0.date >= start && $0.date < end }
            return .init(
                weekNumber: calendar.component(.weekOfYear, from: start),
                lifts: inWeek.filter { $0.kind == .lift }.count,
                runs: inWeek.filter { $0.kind == .run }.count
            )
        }
        return JarvisGymWidgetData(
            generatedAt: now,
            lastDay: today,
            stepGoal: stepGoal,
            dailySteps: days.map { dailySteps[$0] ?? 0 },
            liftsDone: thisWeek.filter { $0.kind == .lift }.count,
            liftsTarget: liftTarget,
            runsDone: thisWeek.filter { $0.kind == .run }.count,
            runsTarget: runTarget,
            trainedDays: days.map { day in workouts.contains { calendar.isDate($0.date, inSameDayAs: day) } },
            kilometers: thisWeek.reduce(0) { $0 + $1.kilometers },
            calories: Int(thisWeek.reduce(0) { $0 + $1.calories }.rounded()),
            weeks: weeks
        )
    }

    public static func factory(
        now: Date,
        calendar: Calendar,
        language: JarvisAppLanguage,
        tasks: [FactoryTaskRecord],
        confirmations: [PendingConfirmation]
    ) -> JarvisFactoryWidgetData {
        func text(_ key: JarvisWidgetCopy) -> String { key.text(language: language) }
        func agentName(_ agent: FactoryAgent) -> String { agent == .codex ? "Codex" : "Copilot" }

        var rows: [JarvisFactoryWidgetData.Task] = []
        var running = 0, awaiting = 0, review = 0, failed = 0

        for confirmation in confirmations {
            awaiting += 1
            let detail = parseDate(confirmation.expiresAt).map {
                JarvisWidgetCopy.expiresAt.formatted(clock($0, language: language, calendar: calendar), language: language)
            } ?? text(.awaiting)
            rows.append(.init(id: confirmation.id, title: confirmation.summary, detail: detail, status: .awaiting, action: .approve))
        }
        for task in tasks {
            switch task.state {
            case .needsAttention where task.latestSessionEndReason == .crashed:
                failed += 1
                rows.append(.init(
                    id: task.id, title: task.title,
                    detail: "\(text(.failed)) · \(text(.sessionEnded))", status: .failed, action: .retry
                ))
            case .needsAttention:
                awaiting += 1
                rows.append(.init(id: task.id, title: task.title, detail: task.activity ?? text(.awaiting), status: .awaiting))
            case .paused:
                awaiting += 1
                rows.append(.init(id: task.id, title: task.title, detail: task.activity ?? text(.awaiting), status: .awaiting, action: .resume))
            case .running, .pauseRequested, .ready:
                if let pullRequest = task.pullRequest {
                    review += 1
                    let checks: JarvisWidgetCopy = switch task.checkConclusion {
                    case "failure": .checksFailed
                    case "success": .checksPassed
                    default: .checksRunning
                    }
                    rows.append(.init(
                        id: task.id, title: task.title,
                        detail: "\(JarvisWidgetCopy.pullRequest.formatted(String(pullRequest.number), language: language)) · \(text(checks))",
                        status: .review
                    ))
                } else if task.state != .ready {
                    running += 1
                    let detail = [agentName(task.agent), task.activity].compactMap { $0 }.joined(separator: " · ")
                    rows.append(.init(
                        id: task.id, title: task.title, detail: detail, status: .running,
                        action: task.state == .running ? .pause : nil
                    ))
                }
            case .done, .cancelled:
                break
            }
        }

        let today = calendar.startOfDay(for: now)
        let days = (0..<JarvisWidgetSnapshot.days).reversed().compactMap { calendar.date(byAdding: .day, value: -$0, to: today) }
        let finished = tasks.filter { $0.state == .done }.compactMap { $0.finishedAt.flatMap(parseDate) }
        let order: [JarvisFactoryWidgetData.Status: Int] = [.awaiting: 0, .failed: 1, .running: 2, .review: 3]
        return JarvisFactoryWidgetData(
            generatedAt: now,
            lastDay: today,
            running: running,
            awaiting: awaiting,
            review: review,
            failed: failed,
            doneLast7Days: days.map { day in finished.filter { calendar.isDate($0, inSameDayAs: day) }.count },
            tasks: rows.enumerated().sorted {
                let (left, right) = (order[$0.element.status] ?? 9, order[$1.element.status] ?? 9)
                return left == right ? $0.offset < $1.offset : left < right
            }.map(\.element)
        )
    }

    /// Today's open tasks (due today, in the app's order) and the latest notes, from lists the app already loaded.
    public static func notes(
        now: Date,
        calendar: Calendar,
        tasks: VaultTaskList,
        notes: [VaultNoteSummary]
    ) -> JarvisNotesWidgetData {
        let dayFormatter = DateFormatter()
        dayFormatter.locale = Locale(identifier: "en_US_POSIX")
        dayFormatter.calendar = calendar
        dayFormatter.timeZone = calendar.timeZone
        dayFormatter.dateFormat = "yyyy-MM-dd"
        let due = JarvisNotesLogic.taskGroups(tasks.items, today: tasks.today).today
        let latest: [JarvisNotesWidgetData.Note] = notes
            .compactMap { note in
                parseDate(note.updatedAt).map { JarvisNotesWidgetData.Note(id: note.path, title: note.title, editedAt: $0) }
            }
            .sorted { $0.editedAt > $1.editedAt }
        return JarvisNotesWidgetData(
            generatedAt: now,
            tasksToday: due.count,
            tasks: due.map {
                JarvisNotesWidgetData.Task(
                    id: $0.id, title: $0.text, time: $0.dueTime, dueDate: $0.dueDate.flatMap(dayFormatter.date(from:))
                )
            },
            notes: latest
        )
    }

    /// What needs Dan (approvals) and what is running, taken from the Factory numbers so both always agree.
    public static func home(now: Date, factory: JarvisFactoryWidgetData) -> JarvisHomeWidgetData {
        JarvisHomeWidgetData(generatedAt: now, approvals: factory.awaiting, running: factory.running)
    }

    private static func parseDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private static func clock(_ date: Date, language: JarvisAppLanguage, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
