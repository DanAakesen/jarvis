import Foundation

public enum JarvisWidgetTopic: String, Sendable {
    case gym, factory
}

/// The six-plus-two widgets, by identifier. The raw value is the WidgetKit `kind`.
public enum JarvisWidgetKind: String, CaseIterable, Sendable {
    case gymSteps = "jarvis.widget.gym.steps"
    case gymWorkouts = "jarvis.widget.gym.workouts"
    case gymMedium = "jarvis.widget.gym.medium"
    case gymLarge = "jarvis.widget.gym.large"
    case factoryStatus = "jarvis.widget.factory.status"
    case factoryDone = "jarvis.widget.factory.done"
    case factoryMedium = "jarvis.widget.factory.medium"
    case factoryLarge = "jarvis.widget.factory.large"

    public var topic: JarvisWidgetTopic {
        switch self {
        case .gymSteps, .gymWorkouts, .gymMedium, .gymLarge: .gym
        case .factoryStatus, .factoryDone, .factoryMedium, .factoryLarge: .factory
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
        case .factory: 15 * 60
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

    public init(
        date: Date,
        language: JarvisAppLanguage,
        gym: JarvisWidgetViewState<JarvisGymWidgetData>,
        factory: JarvisWidgetViewState<JarvisFactoryWidgetData>
    ) {
        self.date = date
        self.language = language
        self.gym = gym
        self.factory = factory
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
                let state: JarvisWidgetViewState<JarvisGymWidgetData> = load == .missing ? .loading : .error
                let factory: JarvisWidgetViewState<JarvisFactoryWidgetData> = load == .missing ? .loading : .error
                return JarvisWidgetEntry(date: date, language: .default, gym: state, factory: factory)
            }
            return JarvisWidgetEntry(
                date: date,
                language: snapshot.appLanguage,
                gym: JarvisWidgetPolicy.resolve(
                    snapshot.gym, topic: .gym, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: date
                ),
                factory: JarvisWidgetPolicy.resolve(
                    snapshot.factory, topic: .factory, generatedAt: \.generatedAt, isEmpty: \.isEmpty, now: date
                )
            )
        }

        var dates = [now]
        let generatedAt: Date? = switch topic {
        case .gym: snapshot?.gym.value?.generatedAt
        case .factory: snapshot?.factory.value?.generatedAt
        }
        if let generatedAt {
            let staleAt = generatedAt.addingTimeInterval(JarvisWidgetPolicy.staleAfter(topic))
            if staleAt > now { dates.append(staleAt) }
        }
        return JarvisWidgetTimelinePlan(
            entries: dates.map(entry(at:)),
            reloadAfter: now.addingTimeInterval(JarvisWidgetPolicy.refreshInterval(topic))
        )
    }
}
