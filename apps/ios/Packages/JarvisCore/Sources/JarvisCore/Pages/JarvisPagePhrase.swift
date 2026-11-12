import Foundation

/// The one headline phrase under a page title. It is written from the page's real data; `{braces}` in the
/// markup mark the key words that the header colours with the accent.
public struct JarvisPagePhrase: Equatable, Sendable {
    public struct Segment: Equatable, Sendable {
        public let text: String
        public let isKey: Bool

        public init(text: String, isKey: Bool) {
            self.text = text
            self.isKey = isKey
        }
    }

    public let segments: [Segment]

    public init(markup: String) {
        var segments: [Segment] = []
        var current = ""
        var key = false
        func flush() {
            guard !current.isEmpty else { return }
            segments.append(Segment(text: current, isKey: key))
            current = ""
        }
        for character in markup {
            if character == "{" {
                flush()
                key = true
            } else if character == "}" {
                flush()
                key = false
            } else {
                current.append(character)
            }
        }
        flush()
        self.segments = segments
    }

    public var plainText: String { segments.map(\.text).joined() }
}

private func number(_ value: Double, _ language: JarvisAppLanguage) -> String {
    JarvisNumberFormat.compact(value, language: language)
}

private func count(_ value: Int, one: String, many: String) -> String {
    "\(value) \(value == 1 ? one : many)"
}

/// Factory header phrase, written from the same counts as the pipeline hero.
public enum JarvisFactoryPagePhrase {
    public struct Counts: Equatable, Sendable {
        public let total: Int
        public let needs: Int
        public let running: Int
        public let review: Int
        public let failed: Int

        public init(board: FactoryBoard) {
            // Every count comes from the same board columns the list below renders, so hero, phrase and list agree.
            let cards = board.columns.flatMap(\.cards)
            total = cards.count
            needs = board.columns.first { $0.id == .needsDan }?.cards.count ?? 0
            running = board.columns.first { $0.id == .inProgress }?.cards.count ?? 0
            review = board.columns.first { $0.id == .inReview }?.cards.count ?? 0
            failed = cards.filter {
                $0.task?.state == .needsAttention && $0.task?.latestSessionEndReason == FactorySessionEndReason.crashed.rawValue
            }.count
        }
    }

    public static func board(
        _ board: FactoryBoard,
        projectName: String,
        segment: FactorySegment,
        language: JarvisAppLanguage
    ) -> JarvisPagePhrase {
        let counts = Counts(board: board)
        let project = "{\(projectName)}"
        if board.columns.allSatisfy({ $0.cards.isEmpty }) {
            return JarvisPagePhrase(markup: "Dan, there are no tasks in \(project) yet.")
        }
        let needs = count(counts.needs, one: "task", many: "tasks")
        let lead: String
        if counts.needs > 0 {
            lead = "Dan, {\(needs)} \(counts.needs == 1 ? "is" : "are") waiting on you"
                + (counts.failed > 0 ? ", and {\(counts.failed)} \(counts.failed == 1 ? "has" : "have") {failed}." : ".")
        } else {
            lead = "Dan, nothing is waiting on you in \(project)."
        }
        var live: [String] = []
        if counts.running > 0 {
            live.append("{\(counts.running)} \(counts.running == 1 ? "is" : "are") running")
        }
        if counts.review > 0 {
            live.append("{\(counts.review)} \(counts.review == 1 ? "is" : "are") in review")
        }
        let tail = live.isEmpty
            ? "Nothing is running right now."
            : live.joined(separator: ", and ") + "."
        return JarvisPagePhrase(markup: lead + " " + tail)
    }

    public static func releases(
        _ view: FactoryReleaseView,
        projectName: String,
        language: JarvisAppLanguage
    ) -> JarvisPagePhrase {
        let project = "{\(projectName)}"
        guard !view.releases.isEmpty else {
            return JarvisPagePhrase(markup: "Dan, there are no releases in \(project) yet.")
        }
        let released = view.releases.first { $0.status == .released }
        let running = view.releases.first { $0.status == .deploying || $0.status == .building }
        let failed = view.releases.filter { $0.status == .failed }.count
        var parts: [String] = []
        if let released { parts.append("{\(released.version)} is deployed") }
        if let running {
            parts.append("{\(running.version)} is deploying now")
        }
        let sentence = parts.isEmpty
            ? "nothing is deployed yet"
            : parts.joined(separator: ", and ")
        var markup = "Dan, \(sentence)."
        if failed > 0 {
            markup += " {\(failed)} \(failed == 1 ? "release has" : "releases have") failed."
        }
        return JarvisPagePhrase(markup: markup)
    }
}

/// Notes header phrase: the tasks that are due, or the shape of the graph on the graph tab.
public enum JarvisNotesPagePhrase {
    public struct TaskCounts: Equatable, Sendable {
        public let open: Int
        public let overdue: Int
        public let dueToday: Int
        public let done: Int

        public init(_ list: VaultTaskList) {
            let open = list.items.filter { !$0.done }
            self.open = open.count
            done = list.items.count - open.count
            overdue = open.filter { ($0.dueDate ?? "9999") < list.today }.count
            dueToday = open.filter { $0.dueDate == list.today }.count
        }
    }

    public static func tasks(_ list: VaultTaskList, language: JarvisAppLanguage) -> JarvisPagePhrase {
        let counts = TaskCounts(list)
        func tasks(_ value: Int) -> String {
            count(value, one: "task", many: "tasks")
        }
        if counts.overdue > 0 {
            return JarvisPagePhrase(markup: "Dan, {\(tasks(counts.overdue))} \(counts.overdue == 1 ? "is" : "are") overdue"
                + (counts.dueToday > 0 ? ", and {\(counts.dueToday)} \(counts.dueToday == 1 ? "is" : "are") due today." : "."))
        }
        if counts.dueToday > 0 {
            return JarvisPagePhrase(markup: "Dan, {\(tasks(counts.dueToday))} \(counts.dueToday == 1 ? "is" : "are") due today, and nothing is overdue.")
        }
        if counts.open > 0 {
            return JarvisPagePhrase(markup: "Dan, nothing is due today, and you have {\(tasks(counts.open))} open.")
        }
        return JarvisPagePhrase(markup: "Dan, all your tasks are done.")
    }

    public static func graph(_ graph: KnowledgeGraph, language: JarvisAppLanguage) -> JarvisPagePhrase {
        guard !graph.nodes.isEmpty else { return empty(language: language) }
        var degrees: [String: Int] = [:]
        for edge in graph.edges {
            degrees[edge.source, default: 0] += 1
            degrees[edge.target, default: 0] += 1
        }
        let top = graph.nodes.max { (degrees[$0.id] ?? 0) < (degrees[$1.id] ?? 0) }
        let notes = count(graph.nodes.count, one: "note", many: "notes")
        let links = count(graph.edges.count, one: "link", many: "links")
        if let top, (degrees[top.id] ?? 0) > 0 {
            return JarvisPagePhrase(markup: "Dan, your {\(notes)} are joined by {\(links)}, and {\(top.title)} is the most connected.")
        }
        return JarvisPagePhrase(markup: "Dan, you have {\(notes)}, and none are linked yet.")
    }

    public static func empty(language: JarvisAppLanguage) -> JarvisPagePhrase {
        JarvisPagePhrase(markup: "Dan, your vault is empty. Write your first {note}.")
    }
}

/// Health header phrase, written from the period's workouts and steps against the targets.
public enum JarvisHealthPagePhrase {
    public struct Input: Equatable, Sendable {
        public let isToday: Bool
        public let gymDone: Int
        public let gymTarget: Double?
        public let steps: Double?
        public let stepsTarget: Double?

        public init(isToday: Bool, gymDone: Int, gymTarget: Double?, steps: Double?, stepsTarget: Double?) {
            self.isToday = isToday
            self.gymDone = gymDone
            self.gymTarget = gymTarget
            self.steps = steps
            self.stepsTarget = stepsTarget
        }
    }

    public static func make(_ input: Input, language: JarvisAppLanguage) -> JarvisPagePhrase {
        let workoutWord = "workout"
        let goalMet = input.gymTarget.map { Double(input.gymDone) >= $0 } ?? false
        guard let steps = input.steps else {
            if input.gymDone > 0 {
                let n = count(input.gymDone, one: "workout", many: "workouts")
                return JarvisPagePhrase(markup: "Dan, you have {\(n)} in this period.")
            }
            return JarvisPagePhrase(markup: "Dan, there is no health data yet. As soon as {Apple Health} has synced, your workouts and steps show up here.")
        }
        let stepsText = number(steps, language)
        if input.isToday {
            let stepsPart: String
            if let target = input.stepsTarget, target > 0 {
                stepsPart = "you are at {\(stepsText)} of \(number(target, language)) steps"
            } else {
                stepsPart = "you have {\(stepsText)} steps"
            }
            guard input.gymTarget != nil else {
                return JarvisPagePhrase(markup: "Dan, \(stepsPart) today.")
            }
            if goalMet {
                return JarvisPagePhrase(markup: "Today’s {\(workoutWord)} is done, Dan, and \(stepsPart).")
            }
            return JarvisPagePhrase(markup: "Dan, \(stepsPart), and today’s {\(workoutWord)} is still open.")
        }
        let gym: String
        if let target = input.gymTarget {
            gym = "\(input.gymDone) of \(number(target, language))"
        } else {
            gym = "\(input.gymDone)"
        }
        let stepsPart: String
        if let target = input.stepsTarget, target > 0 {
            let percent = number((steps / target * 100).rounded(), language) + "%"
            stepsPart = "your steps are at {\(percent)} of the goal"
        } else {
            stepsPart = "you have taken {\(stepsText)} steps"
        }
        return JarvisPagePhrase(markup: "Dan, {\(gym)} workouts are done, and \(stepsPart).")
    }
}

/// Status header phrase, written from the check results.
public enum JarvisStatusPagePhrase {
    public static func make(_ snapshot: JarvisStatusSnapshot, language: JarvisAppLanguage, now: Date? = nil) -> JarvisPagePhrase {
        let healthy = snapshot.entries.filter { $0.status == .ok }.count
        let total = snapshot.entries.count
        guard total > 0 else { return JarvisPagePhrase(markup: "Dan, there are {no checks yet}.") }
        if let now, JarvisStatusLogic.isStale(checkedAt: snapshot.checkedAt, now: now) {
            return JarvisPagePhrase(markup: "Dan, the numbers are {stale}. {\(healthy) of \(total) checks} were healthy.")
        }
        let issues = JarvisStatusLogic.ordered(snapshot.entries).filter { $0.status != .ok }.prefix(3)
        if !issues.isEmpty {
            let clauses = issues.map { entry in
                let name = entry.check.map { JarvisInsightsLocalization.string($0.localizationKey, language: language) }
                    ?? JarvisStatusLogic.readable(entry.id)
                let state: String = switch entry.status {
                case .down: "is down"
                case .degraded: "is degraded"
                case .unknown: "is unconfirmed"
                case .ok: "is healthy"
                }
                return "{\(name)} \(state)"
            }.joined(separator: ", ")
            return JarvisPagePhrase(markup: "Dan, \(clauses). {\(healthy) of \(total) checks} are healthy.")
        }
        return JarvisPagePhrase(markup: "Dan, {all \(total) checks} are healthy.")
    }
}

/// Usage header phrase, written from the period total (cost in DKK when the report has costs).
public enum JarvisUsagePagePhrase {
    public static func make(_ summary: JarvisUsageSummary, language: JarvisAppLanguage) -> JarvisPagePhrase {
        guard summary.usesCost, summary.totalValue > 0 else {
            return JarvisPagePhrase(markup: "Dan, here is your {usage}.")
        }
        let amount = JarvisNumberFormat.compact(summary.totalValue, language: language)
        return JarvisPagePhrase(markup: "Dan, your usage is {\(amount) DKK}.")
    }
}

/// Proactive header phrase, written from the open suggestions and the next check.
public enum JarvisProactivePagePhrase {
    public static func make(status: JarvisProactiveStatus, openItems: Int, language: JarvisAppLanguage, firstTitle: String? = nil) -> JarvisPagePhrase {
        if status.paused {
            return JarvisPagePhrase(markup: "Dan, proactive is {paused}.")
        }
        if let firstTitle, openItems > 0 {
            let safeTitle = firstTitle.replacingOccurrences(of: "{", with: "(").replacingOccurrences(of: "}", with: ")")
            let next = status.nextSlotAt.flatMap(JarvisInsightsDates.parse).map {
                JarvisInsightsDates.format($0, language: language, dateStyle: .none, timeStyle: .short)
            }
            let tail = next.map { " The next check is at {\($0)}." } ?? ""
            return JarvisPagePhrase(markup: "Dan, {\(openItems) \(openItems == 1 ? "finding is" : "findings are")} open, and {\(safeTitle)} is first.\(tail)")
        }
        if openItems > 0 {
            let items = count(openItems, one: "suggestion", many: "suggestions")
            return JarvisPagePhrase(markup: "Dan, Jarvis has {\(items)} for you.")
        }
        return JarvisPagePhrase(markup: "Dan, Jarvis has {no new suggestions} for you.")
    }
}

/// Notifications header phrase, written from what needs Dan, what is running and the updates in the feed.
public enum JarvisNotificationsPagePhrase {
    public static func make(needsYou: Int, running: Int, updates: Int, language: JarvisAppLanguage) -> JarvisPagePhrase {
        if needsYou > 0 {
            return JarvisPagePhrase(markup: "Dan, {\(count(needsYou, one: "approval", many: "approvals"))} \(needsYou == 1 ? "is" : "are") waiting for you.")
        }
        if updates > 0 {
            return JarvisPagePhrase(markup: "Dan, you have {\(count(updates, one: "new update", many: "new updates"))}.")
        }
        if running > 0 {
            return JarvisPagePhrase(markup: "Dan, {\(count(running, one: "task", many: "tasks"))} \(running == 1 ? "is" : "are") running.")
        }
        return JarvisPagePhrase(markup: "Dan, there are {no new notifications}.")
    }
}
