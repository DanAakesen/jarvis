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
    value.formatted(.number.precision(.fractionLength(0)).locale(language.locale))
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
            let cards = board.columns.flatMap(\.cards)
            total = cards.filter { $0.task != nil }.count
            needs = board.columns.first { $0.id == .needsDan }?.cards.count ?? 0
            running = cards.filter { $0.task?.state == .running || $0.task?.state == .pauseRequested }.count
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
        let da = language == .da
        if board.columns.allSatisfy({ $0.cards.isEmpty }) {
            return JarvisPagePhrase(markup: da
                ? "Dan, der er endnu ingen opgaver i \(project)."
                : "Dan, there are no tasks in \(project) yet.")
        }
        let needs = da
            ? count(counts.needs, one: "opgave", many: "opgaver")
            : count(counts.needs, one: "task", many: "tasks")
        if segment == .needsDan {
            if counts.needs == 0 {
                return JarvisPagePhrase(markup: da
                    ? "Dan, intet kræver dig i \(project) lige nu."
                    : "Dan, nothing needs you in \(project) right now.")
            }
            if da {
                return JarvisPagePhrase(markup: "Dan, {\(needs)} kræver dig"
                    + (counts.failed > 0 ? ", og {\(counts.failed)} af dem er {fejlet}." : "."))
            }
            return JarvisPagePhrase(markup: "Dan, {\(needs)} \(counts.needs == 1 ? "needs" : "need") you"
                + (counts.failed > 0 ? ", and {\(counts.failed)} of them \(counts.failed == 1 ? "has" : "have") {failed}." : "."))
        }
        let lead: String
        if counts.needs > 0 {
            if da {
                lead = "Dan, {\(needs)} venter på dig" + (counts.failed > 0 ? ", og {\(counts.failed)} er {fejlet}." : ".")
            } else {
                lead = "Dan, {\(needs)} \(counts.needs == 1 ? "is" : "are") waiting on you"
                    + (counts.failed > 0 ? ", and {\(counts.failed)} \(counts.failed == 1 ? "has" : "have") {failed}." : ".")
            }
        } else {
            lead = da ? "Dan, intet venter på dig i \(project)." : "Dan, nothing is waiting on you in \(project)."
        }
        var live: [String] = []
        if counts.running > 0 {
            live.append(da ? "{\(counts.running)} kører" : "{\(counts.running)} \(counts.running == 1 ? "is" : "are") running")
        }
        if counts.review > 0 {
            live.append(da ? "{\(counts.review)} er til gennemsyn" : "{\(counts.review)} \(counts.review == 1 ? "is" : "are") in review")
        }
        let tail = live.isEmpty
            ? (da ? "Intet kører lige nu." : "Nothing is running right now.")
            : live.joined(separator: da ? ", og " : ", and ") + "."
        return JarvisPagePhrase(markup: lead + " " + tail)
    }

    public static func releases(
        _ view: FactoryReleaseView,
        projectName: String,
        language: JarvisAppLanguage
    ) -> JarvisPagePhrase {
        let da = language == .da
        let project = "{\(projectName)}"
        guard !view.releases.isEmpty else {
            return JarvisPagePhrase(markup: da
                ? "Dan, der er endnu ingen udgivelser i \(project)."
                : "Dan, there are no releases in \(project) yet.")
        }
        let released = view.releases.first { $0.status == .released }
        let running = view.releases.first { $0.status == .deploying || $0.status == .building }
        let failed = view.releases.filter { $0.status == .failed }.count
        var parts: [String] = []
        if let released { parts.append(da ? "{\(released.version)} er udrullet" : "{\(released.version)} is deployed") }
        if let running {
            parts.append(da ? "{\(running.version)} udrulles nu" : "{\(running.version)} is deploying now")
        }
        let sentence = parts.isEmpty
            ? (da ? "intet er udrullet endnu" : "nothing is deployed yet")
            : parts.joined(separator: da ? ", og " : ", and ")
        var markup = "Dan, \(sentence)."
        if failed > 0 {
            markup += da
                ? " {\(failed)} \(failed == 1 ? "udgivelse" : "udgivelser") fejlede."
                : " {\(failed)} \(failed == 1 ? "release has" : "releases have") failed."
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
        let da = language == .da
        func tasks(_ value: Int) -> String {
            da ? count(value, one: "opgave", many: "opgaver") : count(value, one: "task", many: "tasks")
        }
        if counts.overdue > 0 {
            if da {
                return JarvisPagePhrase(markup: "Dan, {\(tasks(counts.overdue))} er \(counts.overdue == 1 ? "forfaldet" : "forfaldne")"
                    + (counts.dueToday > 0 ? ", og {\(counts.dueToday)} skal klares i dag." : "."))
            }
            return JarvisPagePhrase(markup: "Dan, {\(tasks(counts.overdue))} \(counts.overdue == 1 ? "is" : "are") overdue"
                + (counts.dueToday > 0 ? ", and {\(counts.dueToday)} \(counts.dueToday == 1 ? "is" : "are") due today." : "."))
        }
        if counts.dueToday > 0 {
            return JarvisPagePhrase(markup: da
                ? "Dan, {\(tasks(counts.dueToday))} skal klares i dag, og intet er forfaldent."
                : "Dan, {\(tasks(counts.dueToday))} \(counts.dueToday == 1 ? "is" : "are") due today, and nothing is overdue.")
        }
        if counts.open > 0 {
            return JarvisPagePhrase(markup: da
                ? "Dan, intet skal klares i dag, og du har {\(tasks(counts.open))} åbne."
                : "Dan, nothing is due today, and you have {\(tasks(counts.open))} open.")
        }
        return JarvisPagePhrase(markup: da ? "Dan, alle dine opgaver er klaret." : "Dan, all your tasks are done.")
    }

    public static func graph(_ graph: KnowledgeGraph, language: JarvisAppLanguage) -> JarvisPagePhrase {
        let da = language == .da
        guard !graph.nodes.isEmpty else { return empty(language: language) }
        var degrees: [String: Int] = [:]
        for edge in graph.edges {
            degrees[edge.source, default: 0] += 1
            degrees[edge.target, default: 0] += 1
        }
        let top = graph.nodes.max { (degrees[$0.id] ?? 0) < (degrees[$1.id] ?? 0) }
        let notes = da ? count(graph.nodes.count, one: "note", many: "noter") : count(graph.nodes.count, one: "note", many: "notes")
        let links = count(graph.edges.count, one: "link", many: "links")
        if let top, (degrees[top.id] ?? 0) > 0 {
            return JarvisPagePhrase(markup: da
                ? "Dan, dine {\(notes)} er bundet sammen af {\(links)}, og {\(top.title)} er mest forbundet."
                : "Dan, your {\(notes)} are joined by {\(links)}, and {\(top.title)} is the most connected.")
        }
        return JarvisPagePhrase(markup: da
            ? "Dan, du har {\(notes)}, og de er endnu ikke bundet sammen."
            : "Dan, you have {\(notes)}, and none are linked yet.")
    }

    public static func empty(language: JarvisAppLanguage) -> JarvisPagePhrase {
        JarvisPagePhrase(markup: language == .da
            ? "Dan, dit arkiv er tomt. Skriv din første {note}."
            : "Dan, your vault is empty. Write your first {note}.")
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
        let da = language == .da
        let workoutWord = da ? "træning" : "workout"
        let goalMet = input.gymTarget.map { Double(input.gymDone) >= $0 } ?? false
        guard let steps = input.steps else {
            if input.gymDone > 0 {
                let n = da ? count(input.gymDone, one: "træning", many: "træninger") : count(input.gymDone, one: "workout", many: "workouts")
                return JarvisPagePhrase(markup: da ? "Dan, du har {\(n)} i perioden." : "Dan, you have {\(n)} in this period.")
            }
            return JarvisPagePhrase(markup: da
                ? "Dan, der er endnu ingen sundhedsdata. Så snart {Apple Sundhed} har synkroniseret, dukker dine træninger og skridt op her."
                : "Dan, there is no health data yet. As soon as {Apple Health} has synced, your workouts and steps show up here.")
        }
        let stepsText = number(steps, language)
        if input.isToday {
            let stepsPart: String
            if let target = input.stepsTarget, target > 0 {
                stepsPart = da
                    ? "du er på {\(stepsText)} af \(number(target, language)) skridt"
                    : "you are at {\(stepsText)} of \(number(target, language)) steps"
            } else {
                stepsPart = da ? "du har {\(stepsText)} skridt" : "you have {\(stepsText)} steps"
            }
            guard input.gymTarget != nil else {
                return JarvisPagePhrase(markup: da ? "Dan, \(stepsPart) i dag." : "Dan, \(stepsPart) today.")
            }
            if goalMet {
                return JarvisPagePhrase(markup: da
                    ? "Dagens {\(workoutWord)} er klaret, Dan, og \(stepsPart)."
                    : "Today’s {\(workoutWord)} is done, Dan, and \(stepsPart).")
            }
            return JarvisPagePhrase(markup: da
                ? "Dan, \(stepsPart), og dagens {\(workoutWord)} mangler stadig."
                : "Dan, \(stepsPart), and today’s {\(workoutWord)} is still open.")
        }
        let gym: String
        if let target = input.gymTarget {
            gym = "\(input.gymDone)\(da ? " af " : " of ")\(number(target, language))"
        } else {
            gym = "\(input.gymDone)"
        }
        let stepsPart: String
        if let target = input.stepsTarget, target > 0 {
            let percent = number((steps / target * 100).rounded(), language) + (da ? "\u{00a0}%" : "%")
            stepsPart = da ? "skridtene står på {\(percent)} af målet" : "your steps are at {\(percent)} of the goal"
        } else {
            stepsPart = da ? "du har gået {\(stepsText)} skridt" : "you have taken {\(stepsText)} steps"
        }
        return JarvisPagePhrase(markup: da
            ? "Dan, {\(gym)} træninger er klaret, og \(stepsPart)."
            : "Dan, {\(gym)} workouts are done, and \(stepsPart).")
    }
}
