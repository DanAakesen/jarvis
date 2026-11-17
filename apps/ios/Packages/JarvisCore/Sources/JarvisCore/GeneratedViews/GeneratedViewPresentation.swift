import Foundation

/// One numbered line of a code view, ready to draw.
public struct GeneratedCodeLine: Equatable, Sendable, Identifiable {
    public let number: Int
    public let text: String
    public let isHighlighted: Bool

    public var id: Int { number }
}

extension GeneratedCodeData {
    /// The lines to show. The backend escapes the text for the web (`&`, `<`, `>`, `"`, `'`); this turns those
    /// entities back into the characters they stand for. Lines count up from `startLine`; a highlight range names
    /// line numbers in that same numbering.
    public var displayLines: [GeneratedCodeLine] {
        let first = max(startLine ?? 1, 1)
        var rows = Self.unescaped(content).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        if rows.last == "" { rows.removeLast() }
        return rows.enumerated().map { offset, text in
            let number = first + offset
            let highlighted = (highlight ?? []).contains { number >= $0.from && number <= $0.to }
            return GeneratedCodeLine(number: number, text: text, isHighlighted: highlighted)
        }
    }

    /// Repository, path and ref on one line, e.g. `owner/repo · src/app.ts · abc123`.
    public var location: String {
        [repo, path, ref].compactMap { $0 }.filter { !$0.isEmpty }.map(Self.unescaped).joined(separator: " · ")
    }

    private static func unescaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}

extension ChatBlockForecast {
    /// Every value of the forecast as label and value pairs, for "View data". A value the source did not give
    /// reads as `missing`.
    public func dataRows(
        labels: ForecastDataLabels,
        dateText: String,
        locale: Locale,
        missing: String
    ) -> [[String]] {
        func temperature(_ value: Double?) -> String {
            value.map { ChatBlockFormatting.value($0, unit: "°C", locale: locale) } ?? missing
        }
        return [
            [labels.place, place],
            [labels.date, dateText],
            [labels.conditions, conditions],
            [labels.high, temperature(highC)],
            [labels.low, temperature(lowC)],
            [labels.rainChance, rainChancePercent.map { ChatBlockFormatting.value($0, unit: "%", locale: locale) } ?? missing],
        ]
    }
}

/// The row labels of a forecast's data table.
public struct ForecastDataLabels: Equatable, Sendable {
    public let place: String
    public let date: String
    public let conditions: String
    public let high: String
    public let low: String
    public let rainChance: String

    public init(place: String, date: String, conditions: String, high: String, low: String, rainChance: String) {
        self.place = place
        self.date = date
        self.conditions = conditions
        self.high = high
        self.low = low
        self.rainChance = rainChance
    }
}

/// The in-app routes the generated-view contract allows an `open-route` action to name.
public enum GeneratedViewRoute: Equatable, Sendable {
    case home
    case usage
    case settings
    case factoryTask(String)
    case factoryProject
    case factoryRelease

    /// `nil` for a route the contract does not allow.
    public init?(route: String) {
        let path = route.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? route
        switch path {
        case "/": self = .home
        case "/usage": self = .usage
        case "/settings": self = .settings
        default:
            let parts = path.split(separator: "/").map(String.init)
            guard path.hasPrefix("/"), parts.count == 3, parts[0] == "factory", !parts[2].isEmpty, parts[2].count <= 19,
                  parts[2].allSatisfy({ $0.isASCII && $0.isNumber }), parts[2].first != "0" else { return nil }
            switch parts[1] {
            case "tasks": self = .factoryTask(parts[2])
            case "projects": self = .factoryProject
            case "releases": self = .factoryRelease
            default: return nil
            }
        }
    }
}
