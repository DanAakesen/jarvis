import Foundation

/// A lift name the owner typed before, with the session it belongs to and how often it was used.
public struct JarvisRememberedLift: Codable, Equatable, Sendable {
    public let name: String
    public let session: String
    public let uses: Int
    public let lastUsed: Date
}

/// One name offered while typing in the Log lift sheet.
public struct JarvisLiftSuggestion: Equatable, Sendable, Identifiable {
    public let name: String
    public let session: JarvisGymSessionType
    public var id: String { name }
}

/// Lift names the owner has logged, kept on the device so the write-in field gets quick after a few weeks.
/// The built-in lifts are offered until the owner has history of their own.
public struct JarvisLiftNameMemory: Equatable, Sendable {
    public static let defaultsKey = "jarvis.today.liftNames"
    static let maximumEntries = 100

    public private(set) var entries: [JarvisRememberedLift]

    public init(entries: [JarvisRememberedLift] = []) {
        self.entries = entries
    }

    public static func load(from defaults: UserDefaults = .standard) -> JarvisLiftNameMemory {
        guard let data = defaults.data(forKey: defaultsKey),
              let entries = try? JSONDecoder().decode([JarvisRememberedLift].self, from: data) else {
            return JarvisLiftNameMemory()
        }
        return JarvisLiftNameMemory(entries: entries)
    }

    public func save(to defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: Self.defaultsKey)
    }

    static func key(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    public mutating func record(name: String, session: JarvisGymSessionType, at date: Date = Date()) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let uses = (entries.first { Self.key($0.name) == Self.key(clean) }?.uses ?? 0) + 1
        entries.removeAll { Self.key($0.name) == Self.key(clean) }
        entries.append(JarvisRememberedLift(name: clean, session: session.rawValue, uses: uses, lastUsed: date))
        if entries.count > Self.maximumEntries {
            entries = Array(ranked().prefix(Self.maximumEntries))
        }
    }

    private func ranked() -> [JarvisRememberedLift] {
        entries.sorted {
            $0.uses != $1.uses ? $0.uses > $1.uses : $0.lastUsed > $1.lastUsed
        }
    }

    /// Remembered names first (most used, then most recent), then the built-in lifts, filtered by what is typed.
    public func suggestions(
        matching query: String, language: JarvisAppLanguage, limit: Int = 8
    ) -> [JarvisLiftSuggestion] {
        let needle = Self.key(query)
        var seen = Set<String>()
        var result: [JarvisLiftSuggestion] = []
        let remembered = ranked().map {
            JarvisLiftSuggestion(name: $0.name, session: JarvisGymSessionType(rawValue: $0.session) ?? .chest)
        }
        let builtIn = JarvisGymLiftType.allCases.map {
            JarvisLiftSuggestion(name: $0.title(language: language), session: $0.session)
        }
        for suggestion in remembered + builtIn {
            let name = Self.key(suggestion.name)
            guard seen.insert(name).inserted, needle.isEmpty || name.contains(needle), name != needle else { continue }
            result.append(suggestion)
            if result.count == limit { break }
        }
        return result
    }

    /// The session of a name the app already knows, from the owner's history or the built-in lifts in either language.
    public func session(for name: String) -> JarvisGymSessionType? {
        let target = Self.key(name)
        if let known = entries.first(where: { Self.key($0.name) == target }) {
            return JarvisGymSessionType(rawValue: known.session)
        }
        for lift in JarvisGymLiftType.allCases {
            for language in [JarvisAppLanguage.en] where Self.key(lift.title(language: language)) == target {
                return lift.session
            }
        }
        return nil
    }
}
