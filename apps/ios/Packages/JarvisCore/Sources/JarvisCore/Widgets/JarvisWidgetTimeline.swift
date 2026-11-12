import Foundation

public enum JarvisWidgetTopic: String, Sendable {
    case gym, factory, notes, home
}

/// The fourteen widgets, by identifier. The raw value is the WidgetKit `kind`.
public enum JarvisWidgetKind: String, CaseIterable, Sendable {
    case gymSteps = "jarvis.widget.gym.steps"
    case gymWorkouts = "jarvis.widget.gym.workouts"
    case gymMedium = "jarvis.widget.gym.medium"
    case gymLarge = "jarvis.widget.gym.large"
    case factoryStatus = "jarvis.widget.factory.status"
    case factoryDone = "jarvis.widget.factory.done"
    case factoryMedium = "jarvis.widget.factory.medium"
    case factoryLarge = "jarvis.widget.factory.large"
    case notesSmall = "jarvis.widget.notes.small"
    case notesMedium = "jarvis.widget.notes.medium"
    case notesLarge = "jarvis.widget.notes.large"
    case homeSmall = "jarvis.widget.home.small"
    case homeMedium = "jarvis.widget.home.medium"
    case homeLarge = "jarvis.widget.home.large"

    public var topic: JarvisWidgetTopic {
        switch self {
        case .gymSteps, .gymWorkouts, .gymMedium, .gymLarge: .gym
        case .factoryStatus, .factoryDone, .factoryMedium, .factoryLarge: .factory
        case .notesSmall, .notesMedium, .notesLarge: .notes
        case .homeSmall, .homeMedium, .homeLarge: .home
        }
    }
}

/// What a widget shows for one topic.
public enum JarvisWidgetViewState<Value: Equatable & Sendable>: Equatable, Sendable {
    case loading
    case empty
    case error
    case offline
    /// Data to draw. `isStale` data is still drawn, with the age shown next to it.
    case content(Value, isStale: Bool)
}

public enum JarvisWidgetPolicy {
    public static func refreshInterval(_ topic: JarvisWidgetTopic) -> TimeInterval {
        switch topic {
        case .gym: 30 * 60
        case .factory, .notes, .home: 15 * 60
        }
    }

    /// Data older than two refresh intervals is stale: a refresh was missed.
    public static func staleAfter(_ topic: JarvisWidgetTopic) -> TimeInterval {
        refreshInterval(topic) * 2
    }

    public static func resolve<Value: Codable & Equatable & Sendable>(
        _ section: JarvisWidgetSnapshot.Section<Value>,
        topic: JarvisWidgetTopic,
        generatedAt: (Value) -> Date,
        isEmpty: (Value) -> Bool,
        now: Date
    ) -> JarvisWidgetViewState<Value> {
        guard let value = section.value else {
            switch section.status {
            case .error: return .error
            case .offline: return .offline
            case .loading, .ok: return .loading
            }
        }
        if isEmpty(value) && section.status == .ok { return .empty }
        let aged = now.timeIntervalSince(generatedAt(value)) >= staleAfter(topic)
        return .content(value, isStale: aged || section.status == .error || section.status == .offline)
    }
}

public struct JarvisWidgetEntry: Equatable, Sendable {
    public var date: Date
    public var language: JarvisAppLanguage
    public var gym: JarvisWidgetViewState<JarvisGymWidgetData>
    public var factory: JarvisWidgetViewState<JarvisFactoryWidgetData>
    public var notes: JarvisWidgetViewState<JarvisNotesWidgetData>
    public var home: JarvisWidgetViewState<JarvisHomeWidgetData>

    public init(
        date: Date,
        language: JarvisAppLanguage,
        gym: JarvisWidgetViewState<JarvisGymWidgetData>,
        factory: JarvisWidgetViewState<JarvisFactoryWidgetData>,
        notes: JarvisWidgetViewState<JarvisNotesWidgetData> = .loading,
        home: JarvisWidgetViewState<JarvisHomeWidgetData> = .loading
    ) {
        self.date = date
        self.language = language
        self.gym = gym
        self.factory = factory
        self.notes = notes
        self.home = home
    }

    public static func placeholder(at date: Date = Date()) -> JarvisWidgetEntry {
        JarvisWidgetEntry(date: date, language: .default, gym: .loading, factory: .loading)
    }
}

public struct JarvisWidgetTimelinePlan: Equatable, Sendable {
    public var entries: [JarvisWidgetEntry]
    /// When WidgetKit should ask for a new timeline (`.after`).
    public var reloadAfter: Date
}

/// Turns the stored snapshot into scheduled timeline entries: one for now and one for each moment a section turns
/// stale, so staleness shows without a push update. A missing file is loading; an unreadable one is an error.
public enum JarvisWidgetTimeline {
    public static func plan(
        for load: JarvisWidgetSnapshotStore.LoadResult,
        topic: JarvisWidgetTopic,
        now: Date
    ) -> JarvisWidgetTimelinePlan {
        let snapshot: JarvisWidgetSnapshot?
        switch load {
        case .missing, .unreadable: snapshot = nil
        case .snapshot(let value): snapshot = value
        }

        func entry(at date: Date) -> JarvisWidgetEntry {
            guard let snapshot else {
                let missing = load == .missing
                return JarvisWidgetEntry(
                    date: date, language: .default,
                    gym: missing ? .loading : .error, factory: missing ? .loading : .error,
                    notes: missing ? .loading : .error, home: missing ? .loading : .error
                )
            }
            return JarvisWidgetEntry(
                date: date,
                language: .default,
                gym: JarvisWidgetPolicy.resolve(
                    snapshot.gym, topic: .gym, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: date
                ),
                factory: JarvisWidgetPolicy.resolve(
                    snapshot.factory, topic: .factory, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: date
                ),
                notes: JarvisWidgetPolicy.resolve(
                    snapshot.notes, topic: .notes, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: date
                ),
                home: JarvisWidgetPolicy.resolve(
                    snapshot.home, topic: .home, generatedAt: \.generatedAt, isEmpty: { _ in false }, now: date
                )
            )
        }

        // Each section the topic draws turns stale on its own schedule; the Home widgets draw all four.
        var generated: [(date: Date, topic: JarvisWidgetTopic)] = []
        if let snapshot {
            if [.gym, .home].contains(topic), let date = snapshot.gym.value?.generatedAt { generated.append((date, .gym)) }
            if [.factory, .home].contains(topic), let date = snapshot.factory.value?.generatedAt { generated.append((date, .factory)) }
            if [.notes, .home].contains(topic), let date = snapshot.notes.value?.generatedAt { generated.append((date, .notes)) }
            if topic == .home, let date = snapshot.home.value?.generatedAt { generated.append((date, .home)) }
        }
        let staleDates = generated
            .map { $0.date.addingTimeInterval(JarvisWidgetPolicy.staleAfter($0.topic)) }
            .filter { $0 > now }
        let dates = [now] + Set(staleDates).sorted()
        return JarvisWidgetTimelinePlan(
            entries: dates.map(entry(at:)),
            reloadAfter: now.addingTimeInterval(JarvisWidgetPolicy.refreshInterval(topic))
        )
    }
}

/// The link a widget tap carries (`widgetURL`) and the app page it opens. The scheme is only ever handled by the
/// app's own `onOpenURL`; it carries no data beyond the topic.
public enum JarvisWidgetLink {
    public static let scheme = "jarvis-widget"

    public static func url(for topic: JarvisWidgetTopic) -> URL {
        URL(string: "\(scheme)://\(topic.rawValue)") ?? URL(fileURLWithPath: "/")
    }

    public static func destination(for url: URL) -> JarvisDestination? {
        guard url.scheme == scheme, let host = url.host, let topic = JarvisWidgetTopic(rawValue: host) else { return nil }
        switch topic {
        case .gym: return .health
        case .factory: return .softwareFactory
        case .notes: return .notes
        case .home: return .today
        }
    }
}
