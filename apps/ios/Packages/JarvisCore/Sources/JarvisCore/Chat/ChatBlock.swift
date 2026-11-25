import Foundation

/// Where a block's content came from and when it was issued. Both stay with the block for good.
public struct ChatBlockSource: Codable, Equatable, Sendable {
    public let label: String
    public let url: String?
    /// RFC 3339 instant the content was issued; never replaced when a block is shown again.
    public let issuedAt: String
    public let status: String?
    public let reason: String?

    public var isPartial: Bool { status == "partial" }

    public init(label: String, url: String? = nil, issuedAt: String, status: String? = nil, reason: String? = nil) {
        self.label = label
        self.url = url
        self.issuedAt = issuedAt
        self.status = status
        self.reason = reason
    }
}

public struct ChatBlockForecast: Codable, Equatable, Sendable {
    public let place: String
    /// Calendar date, YYYY-MM-DD, in the place's own time zone.
    public let date: String
    public let conditions: String
    public let symbol: String
    public let highC: Double?
    public let lowC: Double?
    public let rainChancePercent: Double?
}

public struct ChatBlockChartPoint: Codable, Equatable, Sendable {
    public let x: GeneratedChartPoint.Coordinate
    /// `nil` is a missing value; it is shown as missing, never as zero.
    public let y: Double?

    public init(x: GeneratedChartPoint.Coordinate, y: Double?) {
        self.x = x
        self.y = y
    }
}

public struct ChatBlockChartSeries: Codable, Equatable, Sendable {
    public let name: String
    public let points: [ChatBlockChartPoint]

    public init(name: String, points: [ChatBlockChartPoint]) {
        self.name = name
        self.points = points
    }
}

/// One panel is one unit on one value scale. Units are never mixed within a panel.
public struct ChatBlockChartPanel: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Equatable, Sendable {
        case line
        case bar
        case area
    }

    public let title: String
    public let unit: String
    public let kind: Kind
    public let series: [ChatBlockChartSeries]

    public init(title: String, unit: String, kind: Kind, series: [ChatBlockChartSeries]) {
        self.title = title
        self.unit = unit
        self.kind = kind
        self.series = series
    }
}

public struct ChatBlockChart: Codable, Equatable, Sendable {
    public let xLabel: String
    public let panels: [ChatBlockChartPanel]

    public init(xLabel: String, panels: [ChatBlockChartPanel]) {
        self.xLabel = xLabel
        self.panels = panels
    }
}

/// Typed, data-only content that belongs to one assistant message. A block is never code.
public struct ChatBlock: Equatable, Sendable, Identifiable {
    public static let supportedVersion = 1

    public enum Content: Equatable, Sendable {
        case forecast(ChatBlockForecast)
        case chart(ChatBlockChart)
        case view(GeneratedView)
        /// A newer or malformed block: it keeps its raw data and still shows its title and text alternative.
        case unsupported(type: String, raw: JSONValue)
    }

    public let version: Int
    public let id: String
    public let type: String
    public let title: String
    public let source: ChatBlockSource
    /// Text alternative that states what the block shows.
    public let summary: String
    public let artifactVersion: Int?
    public let content: Content

    public init(
        version: Int = ChatBlock.supportedVersion,
        id: String,
        type: String,
        title: String,
        source: ChatBlockSource,
        summary: String,
        content: Content,
        artifactVersion: Int? = nil
    ) {
        self.version = version
        self.id = id
        self.type = type
        self.title = title
        self.source = source
        self.summary = summary
        self.content = content
        self.artifactVersion = artifactVersion
    }
}

extension ChatBlock: Codable {
    private enum Keys: String, CodingKey {
        case version, id, type, title, source, summary, data, artifactVersion
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        version = try container.decode(Int.self, forKey: .version)
        id = try container.decode(String.self, forKey: .id)
        type = try container.decode(String.self, forKey: .type)
        title = try container.decode(String.self, forKey: .title)
        source = try container.decode(ChatBlockSource.self, forKey: .source)
        summary = try container.decode(String.self, forKey: .summary)
        artifactVersion = try container.decodeIfPresent(Int.self, forKey: .artifactVersion)
        let raw = try container.decodeIfPresent(JSONValue.self, forKey: .data) ?? .null
        content = Self.content(type: type, version: version, raw: raw, userInfo: decoder.userInfo)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(version, forKey: .version)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(title, forKey: .title)
        try container.encode(source, forKey: .source)
        try container.encode(summary, forKey: .summary)
        try container.encodeIfPresent(artifactVersion, forKey: .artifactVersion)
        switch content {
        case .forecast(let value): try container.encode(value, forKey: .data)
        case .chart(let value): try container.encode(value, forKey: .data)
        case .view(let value): try container.encode(["view": value], forKey: .data)
        case .unsupported(_, let raw): try container.encode(raw, forKey: .data)
        }
    }

    private static func content(
        type: String,
        version: Int,
        raw: JSONValue,
        userInfo: [CodingUserInfoKey: Any]
    ) -> Content {
        let unsupported = Content.unsupported(type: type, raw: raw)
        guard version == supportedVersion, let encoded = try? JSONEncoder().encode(raw) else { return unsupported }
        let decoder = JSONDecoder()
        decoder.userInfo = userInfo
        switch type {
        case "forecast":
            return (try? decoder.decode(ChatBlockForecast.self, from: encoded)).map(Content.forecast) ?? unsupported
        case "chart":
            guard let chart = try? decoder.decode(ChatBlockChart.self, from: encoded),
                  !chart.panels.isEmpty else { return unsupported }
            return .chart(chart)
        case "view", "voice-window":
            guard case .object(let object) = raw, let view = object["view"],
                  let viewData = try? JSONEncoder().encode(view),
                  let decoded = try? decoder.decode(GeneratedView.self, from: viewData) else { return unsupported }
            return .view(decoded)
        default:
            return unsupported
        }
    }
}

extension ChatBlock {
    private struct Skipped: Decodable {}

    /// Reads a list of blocks and drops an entry that is not a block at all, so one bad entry never costs the
    /// message or the history page around it. A block of an unknown type is kept and shows its text alternative.
    static func decodeLossy<Key: CodingKey>(
        from container: KeyedDecodingContainer<Key>,
        forKey key: Key
    ) -> [ChatBlock] {
        guard var list = try? container.nestedUnkeyedContainer(forKey: key) else { return [] }
        var blocks: [ChatBlock] = []
        while !list.isAtEnd {
            if let block = try? list.decode(ChatBlock.self) {
                blocks.append(block)
            } else {
                _ = try? list.decode(Skipped.self)
            }
        }
        return blocks
    }
}
