import Foundation

public enum GeneratedViewLimits {
    public static let actionsPerView = 10
    public static let chartSeries = 5
    public static let chartPoints = 1_000
    public static let htmlArtifactBytes = 512 * 1024
}

public enum GeneratedViewRenderer: String, CaseIterable, Codable, Equatable, Sendable {
    case table
    case list
    case detail
    case text
    case timeline
    case chart
    case taskCard = "task-card"
    case status
    case image
    case htmlApp = "html-app"
    case knowledgeGraph = "knowledge-graph"
    case code
}

public enum GeneratedViewActionType: String, CaseIterable, Codable, Equatable, Sendable {
    case openRoute = "open-route"
    case openLink = "open-link"
    case callTool = "call-tool"
    case window
}

public enum GeneratedViewDecodingContext {
    public static let trustedBlobHostKey = CodingUserInfoKey(rawValue: "JarvisCore.GeneratedView.trustedBlobHost")!
    public static let registeredToolsKey = CodingUserInfoKey(rawValue: "JarvisCore.GeneratedView.registeredTools")!
}

public enum GeneratedViewValidationError: Error, Equatable, Sendable, LocalizedError {
    case invalid(path: String, reason: String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let path, let reason):
            return "\(path) \(reason)"
        }
    }
}

public struct GeneratedViewPage: Codable, Equatable, Sendable {
    public let limit: Int
    public let offset: Int
    public let total: Int?
    public let nextOffset: Int?

    private enum CodingKeys: String, CodingKey {
        case limit
        case offset
        case total
        case nextOffset
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(limit, forKey: .limit)
        try container.encode(offset, forKey: .offset)
        try container.encodeIfPresent(total, forKey: .total)
        try container.encode(nextOffset, forKey: .nextOffset)
    }
}

public struct GeneratedViewSource: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Equatable, Sendable {
        case running
        case complete
        case partial
        case unavailable
    }

    public let id: String
    public let status: Status
    public let updatedAt: String?
    public let reason: String?
    public let page: GeneratedViewPage?
}

public struct GeneratedViewWindowAction: Codable, Equatable, Sendable {
    public enum Operation: String, Codable, Equatable, Sendable {
        case focus
        case minimise
        case restore
        case close
        case move
        case resize
    }

    public let operation: Operation
    public let windowId: String
    public let x: Double?
    public let y: Double?
    public let width: Double?
    public let height: Double?
}

public enum GeneratedViewAction: Codable, Equatable, Sendable {
    case openRoute(route: String)
    case openLink(url: String, label: String)
    case callTool(tool: String)
    case window(GeneratedViewWindowAction)

    private enum Keys: String, CodingKey {
        case type
        case route
        case url
        case label
        case tool
        case operation
        case windowId
        case x
        case y
        case width
        case height
    }

    public init(from decoder: Decoder) throws {
        let json = try JSONValue(from: decoder)
        let path = GeneratedViewValidator.path(from: decoder.codingPath)
        try GeneratedViewValidator.validateAction(
            json,
            path: path,
            listItem: false,
            registeredTools: decoder.userInfo[GeneratedViewDecodingContext.registeredToolsKey] as? [String]
        )
        guard case .object(let object) = json,
              case .string(let type)? = object["type"] else {
            throw GeneratedViewValidationError.invalid(path: path, reason: "must be an action object")
        }

        switch type {
        case "open-route":
            self = .openRoute(route: try GeneratedViewValidator.string(object["route"], path: "\(path).route", min: 1, max: 200))
        case "open-link":
            self = .openLink(
                url: try GeneratedViewValidator.string(object["url"], path: "\(path).url", min: 1, max: 2_000),
                label: try GeneratedViewValidator.string(object["label"], path: "\(path).label", min: 1, max: 200)
            )
        case "call-tool":
            self = .callTool(tool: try GeneratedViewValidator.string(object["tool"], path: "\(path).tool", min: 1, max: 64))
        case "window":
            let operation = try GeneratedViewValidator.string(object["operation"], path: "\(path).operation", min: 1, max: 20)
            guard let kind = GeneratedViewWindowAction.Operation(rawValue: operation) else {
                throw GeneratedViewValidationError.invalid(path: "\(path).operation", reason: "must be a supported window operation")
            }
            self = .window(GeneratedViewWindowAction(
                operation: kind,
                windowId: try GeneratedViewValidator.string(object["windowId"], path: "\(path).windowId", min: 1, max: 64),
                x: GeneratedViewValidator.optionalNumber(object["x"]),
                y: GeneratedViewValidator.optionalNumber(object["y"]),
                width: GeneratedViewValidator.optionalNumber(object["width"]),
                height: GeneratedViewValidator.optionalNumber(object["height"])
            ))
        default:
            throw GeneratedViewValidationError.invalid(path: "\(path).type", reason: "must be a supported action type")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .openRoute(let route):
            try container.encode("open-route", forKey: .type)
            try container.encode(route, forKey: .route)
        case .openLink(let url, let label):
            try container.encode("open-link", forKey: .type)
            try container.encode(url, forKey: .url)
            try container.encode(label, forKey: .label)
        case .callTool(let tool):
            try container.encode("call-tool", forKey: .type)
            try container.encode(tool, forKey: .tool)
        case .window(let action):
            try container.encode("window", forKey: .type)
            try container.encode(action.operation, forKey: .operation)
            try container.encode(action.windowId, forKey: .windowId)
            try container.encodeIfPresent(action.x, forKey: .x)
            try container.encodeIfPresent(action.y, forKey: .y)
            try container.encodeIfPresent(action.width, forKey: .width)
            try container.encodeIfPresent(action.height, forKey: .height)
        }
    }
}

public struct GeneratedViewLabelValue: Codable, Equatable, Sendable {
    public let label: String
    public let value: String
}

public struct GeneratedTableData: Codable, Equatable, Sendable {
    public let columns: [String]
    public let rows: [[JSONValue]]
}

public struct GeneratedListItem: Codable, Equatable, Sendable {
    public let title: String
    public let description: String?
    public let details: [GeneratedViewLabelValue]?
    public let action: GeneratedViewAction?
}

public struct GeneratedListData: Codable, Equatable, Sendable {
    public let items: [GeneratedListItem]
}

public struct GeneratedDetailData: Codable, Equatable, Sendable {
    public let fields: [GeneratedViewLabelValue]
}

public struct GeneratedTextData: Codable, Equatable, Sendable {
    public enum Format: String, Codable, Equatable, Sendable {
        case plain
        case markdown
    }

    public let format: Format
    public let content: String
}

public struct GeneratedTimelineEvent: Codable, Equatable, Sendable {
    public let at: String?
    public let label: String?
    public let title: String
    public let description: String?
}

public struct GeneratedTimelineData: Codable, Equatable, Sendable {
    public let events: [GeneratedTimelineEvent]
}

public struct GeneratedChartPoint: Codable, Equatable, Sendable {
    public enum Coordinate: Codable, Equatable, Sendable {
        case number(Double)
        case string(String)

        public init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let number = try? container.decode(Double.self) {
                self = .number(number)
            } else if let string = try? container.decode(String.self) {
                self = .string(string)
            } else {
                throw DecodingError.typeMismatch(
                    Coordinate.self,
                    DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Expected a number or string")
                )
            }
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .number(let value):
                try container.encode(value)
            case .string(let value):
                try container.encode(value)
            }
        }
    }

    public let x: Coordinate
    public let y: Double
}

public struct GeneratedChartSeries: Codable, Equatable, Sendable {
    public let name: String
    public let points: [GeneratedChartPoint]
}

public struct GeneratedChartData: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Equatable, Sendable {
        case line
        case bar
        case area
    }

    public let kind: Kind
    public let series: [GeneratedChartSeries]
}

public struct GeneratedTaskCardData: Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let state: String
    public let summary: String?
}

public struct GeneratedStatusData: Codable, Equatable, Sendable {
    public enum State: String, Codable, Equatable, Sendable {
        case ok
        case warning
        case error
        case unknown
    }

    public let label: String
    public let value: String?
    public let state: State
}

public struct GeneratedImage: Codable, Equatable, Sendable {
    public let url: String
    public let alt: String
}

public struct GeneratedImageData: Codable, Equatable, Sendable {
    public let images: [GeneratedImage]
}

public struct GeneratedHTMLAppData: Codable, Equatable, Sendable {
    public let artifactId: String
}

public struct GeneratedKnowledgeGraphData: Codable, Equatable, Sendable {
    public let query: String
    public let highlight: [String]
}

public struct GeneratedCodeLineRange: Codable, Equatable, Sendable {
    public let from: Int
    public let to: Int
}

public struct GeneratedCodeData: Codable, Equatable, Sendable {
    public let repo: String
    public let path: String
    public let ref: String?
    public let language: String?
    public let content: String
    public let startLine: Int?
    public let highlight: [GeneratedCodeLineRange]?
    public let query: String?
}

public struct GeneratedViewEnvelope<Data: Codable & Equatable & Sendable>: Equatable, Sendable {
    public let title: String
    public let source: GeneratedViewSource
    public let data: Data
    public let actions: [GeneratedViewAction]?
}

public enum GeneratedView: Codable, Equatable, Sendable {
    public static let supportedVersion = 1

    case table(GeneratedViewEnvelope<GeneratedTableData>)
    case list(GeneratedViewEnvelope<GeneratedListData>)
    case detail(GeneratedViewEnvelope<GeneratedDetailData>)
    case text(GeneratedViewEnvelope<GeneratedTextData>)
    case timeline(GeneratedViewEnvelope<GeneratedTimelineData>)
    case chart(GeneratedViewEnvelope<GeneratedChartData>)
    case taskCard(GeneratedViewEnvelope<GeneratedTaskCardData>)
    case status(GeneratedViewEnvelope<GeneratedStatusData>)
    case image(GeneratedViewEnvelope<GeneratedImageData>)
    case htmlApp(GeneratedViewEnvelope<GeneratedHTMLAppData>)
    case knowledgeGraph(GeneratedViewEnvelope<GeneratedKnowledgeGraphData>)
    case code(GeneratedViewEnvelope<GeneratedCodeData>)
    case unsupportedVersion(version: JSONValue, raw: JSONValue)
    case unknown(renderer: String, raw: JSONValue)

    private enum Keys: String, CodingKey {
        case version
        case renderer
    }

    public init(from decoder: Decoder) throws {
        let raw = try JSONValue(from: decoder)
        let root = try GeneratedViewValidator.object(raw, path: "view")
        guard let version = root["version"] else {
            throw GeneratedViewValidationError.invalid(path: "view.version", reason: "is required")
        }
        guard case .number(let number) = version, number == Double(Self.supportedVersion) else {
            self = .unsupportedVersion(version: version, raw: raw)
            return
        }
        guard let rendererValue = root["renderer"] else {
            throw GeneratedViewValidationError.invalid(path: "view.renderer", reason: "is required")
        }
        guard case .string(let rendererName) = rendererValue else {
            throw GeneratedViewValidationError.invalid(path: "view.renderer", reason: "must be a string")
        }
        guard let renderer = GeneratedViewRenderer(rawValue: rendererName) else {
            self = .unknown(renderer: rendererName, raw: raw)
            return
        }

        try GeneratedViewValidator.validate(
            raw,
            trustedBlobHost: decoder.userInfo[GeneratedViewDecodingContext.trustedBlobHostKey] as? String,
            registeredTools: decoder.userInfo[GeneratedViewDecodingContext.registeredToolsKey] as? [String]
        )
        switch renderer {
        case .table:
            self = .table(try Self.decodeEnvelope(GeneratedTableData.self, from: raw))
        case .list:
            self = .list(try Self.decodeEnvelope(GeneratedListData.self, from: raw))
        case .detail:
            self = .detail(try Self.decodeEnvelope(GeneratedDetailData.self, from: raw))
        case .text:
            self = .text(try Self.decodeEnvelope(GeneratedTextData.self, from: raw))
        case .timeline:
            self = .timeline(try Self.decodeEnvelope(GeneratedTimelineData.self, from: raw))
        case .chart:
            self = .chart(try Self.decodeEnvelope(GeneratedChartData.self, from: raw))
        case .taskCard:
            self = .taskCard(try Self.decodeEnvelope(GeneratedTaskCardData.self, from: raw))
        case .status:
            self = .status(try Self.decodeEnvelope(GeneratedStatusData.self, from: raw))
        case .image:
            self = .image(try Self.decodeEnvelope(GeneratedImageData.self, from: raw))
        case .htmlApp:
            self = .htmlApp(try Self.decodeEnvelope(GeneratedHTMLAppData.self, from: raw))
        case .knowledgeGraph:
            self = .knowledgeGraph(try Self.decodeEnvelope(GeneratedKnowledgeGraphData.self, from: raw))
        case .code:
            self = .code(try Self.decodeEnvelope(GeneratedCodeData.self, from: raw))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .table(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "table", to: encoder)
        case .list(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "list", to: encoder)
        case .detail(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "detail", to: encoder)
        case .text(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "text", to: encoder)
        case .timeline(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "timeline", to: encoder)
        case .chart(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "chart", to: encoder)
        case .taskCard(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "task-card", to: encoder)
        case .status(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "status", to: encoder)
        case .image(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "image", to: encoder)
        case .htmlApp(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "html-app", to: encoder)
        case .knowledgeGraph(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "knowledge-graph", to: encoder)
        case .code(let envelope):
            try Self.encodeEnvelope(envelope, renderer: "code", to: encoder)
        case .unsupportedVersion(_, let raw), .unknown(_, let raw):
            try raw.encode(to: encoder)
        }
    }

    private static func decodeEnvelope<Data: Codable & Equatable & Sendable>(
        _ type: Data.Type,
        from raw: JSONValue
    ) throws -> GeneratedViewEnvelope<Data> {
        do {
            let encoded = try JSONEncoder().encode(raw)
            return try JSONDecoder().decode(GeneratedViewEnvelopeDecoder<Data>.self, from: encoded).envelope
        } catch let error as GeneratedViewValidationError {
            throw error
        } catch {
            throw GeneratedViewValidationError.invalid(path: "view.data", reason: "does not match its renderer model")
        }
    }

    private static func encodeEnvelope<Data: Codable & Equatable & Sendable>(
        _ envelope: GeneratedViewEnvelope<Data>,
        renderer: String,
        to encoder: Encoder
    ) throws {
        try GeneratedViewEnvelopeEncoder(
            title: envelope.title,
            renderer: renderer,
            version: GeneratedView.supportedVersion,
            source: envelope.source,
            data: envelope.data,
            actions: envelope.actions
        ).encode(to: encoder)
    }
}

private struct GeneratedViewEnvelopeDecoder<Data: Codable & Equatable & Sendable>: Decodable {
    let envelope: GeneratedViewEnvelope<Data>

    private enum CodingKeys: String, CodingKey {
        case title
        case source
        case data
        case actions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        envelope = GeneratedViewEnvelope(
            title: try container.decode(String.self, forKey: .title),
            source: try container.decode(GeneratedViewSource.self, forKey: .source),
            data: try container.decode(Data.self, forKey: .data),
            actions: try container.decodeIfPresent([GeneratedViewAction].self, forKey: .actions)
        )
    }
}

private struct GeneratedViewEnvelopeEncoder<Data: Encodable>: Encodable {
    let title: String
    let renderer: String
    let version: Int
    let source: GeneratedViewSource
    let data: Data
    let actions: [GeneratedViewAction]?

    private enum CodingKeys: String, CodingKey {
        case version
        case title
        case renderer
        case source
        case data
        case actions
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(title, forKey: .title)
        try container.encode(renderer, forKey: .renderer)
        try container.encode(source, forKey: .source)
        try container.encode(data, forKey: .data)
        try container.encodeIfPresent(actions, forKey: .actions)
    }
}

public struct HtmlArtifactSource: Codable, Equatable, Sendable {
    public let title: String
    public let url: String
}

public struct HtmlArtifact: Codable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let html: String
    public let sources: [HtmlArtifactSource]
    public let createdAt: String
    public let pinned: Bool

    public init(from decoder: Decoder) throws {
        let raw = try JSONValue(from: decoder)
        try GeneratedViewValidator.validateHTMLArtifact(raw)
        do {
            let data = try JSONEncoder().encode(raw)
            let decoded = try JSONDecoder().decode(ValidatedHtmlArtifact.self, from: data)
            id = decoded.id
            kind = decoded.kind
            title = decoded.title
            html = decoded.html
            sources = decoded.sources
            createdAt = decoded.createdAt
            pinned = decoded.pinned
        } catch {
            throw GeneratedViewValidationError.invalid(path: "artifact", reason: "does not match the HTML artifact model")
        }
    }
}

private struct ValidatedHtmlArtifact: Decodable {
    let id: String
    let kind: String
    let title: String
    let html: String
    let sources: [HtmlArtifactSource]
    let createdAt: String
    let pinned: Bool
}

private enum GeneratedViewValidator {
    static let renderers = GeneratedViewRenderer.allCases.map(\.rawValue)

    static let actionTypes = GeneratedViewActionType.allCases.map(\.rawValue)
    private static let viewKeys: Set<String> = ["version", "title", "renderer", "source", "data", "actions"]
    private static let sourceIDs: Set<String> = [
        "now", "factory.tasks", "factory.projects", "usage", "image_generation", "html_generation", "research", "knowledge_graph",
    ]
    private static let sourceStatuses: Set<String> = ["running", "complete", "partial", "unavailable"]
    private static let routePattern = try! NSRegularExpression(
        pattern: #"^/(?:$|factory/tasks/[1-9]\d{0,18}|factory/(?:projects|releases)/[1-9]\d{0,15}|usage|settings)(?:\?[^#]*)?$"#
    )
    private static let uuidV4Pattern = try! NSRegularExpression(
        pattern: #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#,
        options: [.caseInsensitive]
    )
    private static let uuidPattern = try! NSRegularExpression(
        pattern: #"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"#,
        options: [.caseInsensitive]
    )

    static func validate(
        _ raw: JSONValue,
        trustedBlobHost: String?,
        registeredTools: [String]?
    ) throws {
        let root = try object(raw, path: "view")
        try checkKeys(root, path: "view", allowed: viewKeys, required: ["version", "title", "renderer", "source", "data"])
        guard case .number(let version)? = root["version"], version == 1 else {
            throw invalid("view.version", "must be the number 1")
        }
        let renderer = try string(root["renderer"], path: "view.renderer", min: 1, max: 200)
        guard renderers.contains(renderer) else { throw invalid("view.renderer", "must be a supported renderer") }
        _ = try string(root["title"], path: "view.title", min: 1, max: 200)
        try validateSource(root["source"], path: "view.source")
        try validateData(
            renderer: renderer,
            value: root["data"],
            path: "view.data",
            trustedBlobHost: trustedBlobHost,
            registeredTools: registeredTools
        )
        if let actions = root["actions"] {
            guard case .array(let values) = actions else { throw invalid("view.actions", "must be an array") }
            guard values.count <= GeneratedViewLimits.actionsPerView else {
                throw invalid("view.actions", "must have at most 10 actions")
            }
            for (index, action) in values.enumerated() {
                try validateAction(
                    action,
                    path: "view.actions[\(index)]",
                    listItem: false,
                    registeredTools: registeredTools
                )
            }
        }
        guard serializedJSONByteCount(raw) <= 256 * 1024 else {
            throw invalid("view", "must not exceed 256 KiB of JSON")
        }
    }

    static func validateAction(
        _ value: JSONValue,
        path: String,
        listItem: Bool,
        registeredTools: [String]? = nil
    ) throws {
        let action = try object(value, path: path)
        guard let type = action["type"]?.stringValue else {
            throw invalid("\(path).type", "is required")
        }
        let allowedTypes = listItem ? ["open-route", "open-link"] : actionTypes
        guard allowedTypes.contains(type) else {
            throw invalid("\(path).type", "must be one of \(allowedTypes.joined(separator: ", "))")
        }
        switch type {
        case "open-route":
            try checkKeys(action, path: path, allowed: ["type", "route"], required: ["type", "route"])
            let route = try string(action["route"], path: "\(path).route", min: 1, max: 200)
            guard matches(routePattern, route), !route.contains("\\") else {
                throw invalid("\(path).route", "must be a supported application route")
            }
            if let match = route.range(of: #"/factory/tasks/([1-9]\d{0,18})"#, options: .regularExpression),
               let taskId = route[match].split(separator: "/").last,
               let integer = UInt64(taskId), integer > 9_223_372_036_854_775_807 {
                throw invalid("\(path).route", "contains an out-of-range task identifier")
            }
        case "open-link":
            try checkKeys(action, path: path, allowed: ["type", "url", "label"], required: ["type", "url", "label"])
            let url = try string(action["url"], path: "\(path).url", min: 1, max: 2_000)
            guard safeHTTPS(url, hosts: ["github.com", "learn.microsoft.com"], allowAzureSubdomains: true) else {
                throw invalid("\(path).url", "must be a safe HTTPS link on an allowed host")
            }
            _ = try string(action["label"], path: "\(path).label", min: 1, max: 200)
        case "call-tool":
            try checkKeys(action, path: path, allowed: ["type", "tool"], required: ["type", "tool"])
            let tool = try string(action["tool"], path: "\(path).tool", min: 1, max: 64)
            guard tool.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil else {
                throw invalid("\(path).tool", "must contain only letters, digits, _ or -")
            }
            if let registeredTools, !registeredTools.contains(tool) {
                throw invalid("\(path).tool", "is not a registered tool")
            }
        case "window":
            try validateWindowAction(action, path: path)
        default:
            throw invalid("\(path).type", "must be a supported action type")
        }
    }

    static func validateHTMLArtifact(_ value: JSONValue) throws {
        let artifact = try object(value, path: "artifact")
        try checkKeys(
            artifact,
            path: "artifact",
            allowed: ["id", "kind", "title", "html", "sources", "createdAt", "pinned"],
            required: ["id", "kind", "title", "html", "sources", "createdAt", "pinned"]
        )
        let id = try string(artifact["id"], path: "artifact.id", min: 1, max: 36)
        guard matches(uuidPattern, id) else { throw invalid("artifact.id", "must be a UUID") }
        guard try string(artifact["kind"], path: "artifact.kind", min: 1, max: 10) == "html" else {
            throw invalid("artifact.kind", "must be html")
        }
        let title = try string(artifact["title"], path: "artifact.title", min: 1, max: 200)
        guard title == title.trimmingCharacters(in: .whitespacesAndNewlines) else {
            throw invalid("artifact.title", "must not have surrounding whitespace")
        }
        let html = try string(
            artifact["html"],
            path: "artifact.html",
            min: 1,
            max: GeneratedViewLimits.htmlArtifactBytes
        )
        guard html.utf8.count <= GeneratedViewLimits.htmlArtifactBytes else {
            throw invalid("artifact.html", "must not exceed 512 KiB in UTF-8")
        }
        guard html.range(of: #"<base\b"#, options: [.regularExpression, .caseInsensitive]) == nil,
              html.range(of: #"<script\b[^>]*\bsrc\s*="#, options: [.regularExpression, .caseInsensitive]) == nil else {
            throw invalid("artifact.html", "must not contain a base element or external script")
        }
        let createdAt = try string(artifact["createdAt"], path: "artifact.createdAt", min: 1, max: 30)
        guard validHTMLArtifactTimestamp(createdAt) else {
            throw invalid("artifact.createdAt", "must be a canonical UTC date-time with millisecond precision")
        }
        guard case .bool? = artifact["pinned"] else { throw invalid("artifact.pinned", "must be a boolean") }
        guard case .array(let sources)? = artifact["sources"], sources.count <= 50 else {
            throw invalid("artifact.sources", "must be an array of at most 50 sources")
        }
        var sourceURLs = Set<String>()
        for (index, sourceValue) in sources.enumerated() {
            let path = "artifact.sources[\(index)]"
            let source = try object(sourceValue, path: path)
            try checkKeys(source, path: path, allowed: ["title", "url"], required: ["title", "url"])
            let sourceTitle = try string(source["title"], path: "\(path).title", min: 1, max: 200)
            guard sourceTitle == sourceTitle.trimmingCharacters(in: .whitespacesAndNewlines) else {
                throw invalid("\(path).title", "must not have surrounding whitespace")
            }
            let url = try string(source["url"], path: "\(path).url", min: 1, max: 2_048)
            guard url == url.trimmingCharacters(in: .whitespacesAndNewlines) else {
                throw invalid("\(path).url", "must not have surrounding whitespace")
            }
            guard var components = URLComponents(string: url), components.scheme?.lowercased() == "https",
                  components.host?.isEmpty == false, components.user == nil, components.password == nil,
                  components.port == nil || components.port == 443 else {
                throw invalid("\(path).url", "must be an HTTPS URL")
            }
            components.host = components.host?.lowercased()
            if components.port == 443 { components.port = nil }
            guard let normalizedURL = components.url?.absoluteString,
                  sourceURLs.insert(normalizedURL).inserted else {
                throw invalid("\(path).url", "must be unique")
            }
        }
    }

    static func path(from codingPath: [CodingKey]) -> String {
        let suffix = codingPath.map(\.stringValue).joined(separator: ".")
        return suffix.isEmpty ? "view" : suffix
    }

    static func string(_ value: JSONValue?, path: String, min: Int, max: Int, nonWhitespace: Bool = false) throws -> String {
        guard case .string(let string)? = value else { throw invalid(path, "must be a string") }
        guard string.utf16.count >= min, string.utf16.count <= max else {
            throw invalid(path, "must contain \(min)-\(max) characters")
        }
        if nonWhitespace && string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw invalid(path, "must not be blank")
        }
        return string
    }

    static func optionalNumber(_ value: JSONValue?) -> Double? {
        guard case .number(let number)? = value else { return nil }
        return number
    }

    static func object(_ value: JSONValue, path: String) throws -> [String: JSONValue] {
        guard case .object(let object) = value else { throw invalid(path, "must be an object") }
        return object
    }

    private static func validateSource(_ value: JSONValue?, path: String) throws {
        guard let value else { throw invalid(path, "is required") }
        let source = try object(value, path: path)
        try checkKeys(
            source,
            path: path,
            allowed: ["id", "status", "updatedAt", "reason", "page"],
            required: ["id", "status"]
        )
        let id = try string(source["id"], path: "\(path).id", min: 1, max: 40)
        guard sourceIDs.contains(id) else { throw invalid("\(path).id", "must be a supported source id") }
        let status = try string(source["status"], path: "\(path).status", min: 1, max: 20)
        guard sourceStatuses.contains(status) else { throw invalid("\(path).status", "must be a supported status") }
        if let updatedAt = source["updatedAt"] { _ = try dateTime(updatedAt, path: "\(path).updatedAt") }
        if let reason = source["reason"] { _ = try string(reason, path: "\(path).reason", min: 0, max: 500) }
        if let pageValue = source["page"] {
            let page = try object(pageValue, path: "\(path).page")
            try checkKeys(
                page,
                path: "\(path).page",
                allowed: ["limit", "offset", "total", "nextOffset"],
                required: ["limit", "offset", "nextOffset"]
            )
            let limit = try integer(page["limit"], path: "\(path).page.limit", minimum: 1, maximum: 1_000)
            let offset = try integer(page["offset"], path: "\(path).page.offset", minimum: 0, maximum: 10_000)
            let nextOffset: Int?
            if case .null? = page["nextOffset"] {
                nextOffset = nil
            } else {
                nextOffset = try integer(page["nextOffset"], path: "\(path).page.nextOffset", minimum: 0, maximum: 10_000)
            }
            if let nextOffset, nextOffset != offset + limit {
                throw invalid("\(path).page.nextOffset", "must equal offset plus limit")
            }
            if let totalValue = page["total"] {
                let total = try integer(totalValue, path: "\(path).page.total", minimum: 0, maximum: 1_000_000)
                if offset > total || (nextOffset != nil && nextOffset! >= total) ||
                    (nextOffset == nil && offset + limit < total) {
                    throw invalid("\(path).page.total", "must agree with the page range")
                }
            }
        }
    }

    private static func validateData(
        renderer: String,
        value: JSONValue?,
        path: String,
        trustedBlobHost: String?,
        registeredTools: [String]?
    ) throws {
        guard let value else { throw invalid(path, "is required") }
        let data = try object(value, path: path)
        switch renderer {
        case "table":
            try checkKeys(data, path: path, allowed: ["columns", "rows"], required: ["columns", "rows"])
            let columns = try array(data["columns"], path: "\(path).columns", min: 1, max: 20)
            for (index, column) in columns.enumerated() {
                _ = try string(column, path: "\(path).columns[\(index)]", min: 1, max: 80)
            }
            let rows = try array(data["rows"], path: "\(path).rows", min: 0, max: 500)
            for (rowIndex, rowValue) in rows.enumerated() {
                guard case .array(let row) = rowValue else { throw invalid("\(path).rows[\(rowIndex)]", "must be an array") }
                guard row.count == columns.count else {
                    throw invalid("\(path).rows[\(rowIndex)]", "must have one cell per column")
                }
                for (columnIndex, cell) in row.enumerated() {
                    switch cell {
                    case .string(let string) where string.utf16.count <= 2_000:
                        break
                    case .number, .bool, .null:
                        break
                    default:
                        throw invalid("\(path).rows[\(rowIndex)][\(columnIndex)]", "must be a short string, number, boolean or null")
                    }
                }
            }
        case "list":
            try checkKeys(data, path: path, allowed: ["items"], required: ["items"])
            let items = try array(data["items"], path: "\(path).items", min: 0, max: 500)
            for (index, itemValue) in items.enumerated() {
                let itemPath = "\(path).items[\(index)]"
                let item = try object(itemValue, path: itemPath)
                try checkKeys(item, path: itemPath, allowed: ["title", "description", "details", "action"], required: ["title"])
                _ = try string(item["title"], path: "\(itemPath).title", min: 1, max: 200)
                if let description = item["description"] {
                    _ = try string(description, path: "\(itemPath).description", min: 0, max: 2_000)
                }
                if let detailsValue = item["details"] {
                    let details = try array(detailsValue, path: "\(itemPath).details", min: 0, max: 10)
                    for (detailIndex, detailValue) in details.enumerated() {
                        try validateLabelValue(detailValue, path: "\(itemPath).details[\(detailIndex)]")
                    }
                }
                if let action = item["action"] {
                    try validateAction(
                        action,
                        path: "\(itemPath).action",
                        listItem: true,
                        registeredTools: registeredTools
                    )
                }
            }
        case "detail":
            try checkKeys(data, path: path, allowed: ["fields"], required: ["fields"])
            let fields = try array(data["fields"], path: "\(path).fields", min: 0, max: 100)
            for (index, field) in fields.enumerated() {
                try validateLabelValue(field, path: "\(path).fields[\(index)]")
            }
        case "text":
            try checkKeys(data, path: path, allowed: ["format", "content"], required: ["format", "content"])
            let format = try string(data["format"], path: "\(path).format", min: 1, max: 20)
            guard ["plain", "markdown"].contains(format) else { throw invalid("\(path).format", "must be plain or markdown") }
            _ = try string(data["content"], path: "\(path).content", min: 0, max: 10_000)
        case "timeline":
            try checkKeys(data, path: path, allowed: ["events"], required: ["events"])
            let events = try array(data["events"], path: "\(path).events", min: 0, max: 500)
            for (index, eventValue) in events.enumerated() {
                let eventPath = "\(path).events[\(index)]"
                let event = try object(eventValue, path: eventPath)
                try checkKeys(event, path: eventPath, allowed: ["at", "label", "title", "description"], required: ["title"])
                guard event["at"] != nil || event["label"] != nil else {
                    throw invalid(eventPath, "requires at or label")
                }
                if let at = event["at"] { try validateTimelineDate(at, path: "\(eventPath).at") }
                if let label = event["label"] {
                    let value = try string(label, path: "\(eventPath).label", min: 1, max: Int.max)
                    guard value.unicodeScalars.count <= 40 else {
                        throw invalid("\(eventPath).label", "must contain 1-40 characters")
                    }
                }
                _ = try string(event["title"], path: "\(eventPath).title", min: 1, max: 200)
                if let description = event["description"] {
                    _ = try string(description, path: "\(eventPath).description", min: 0, max: 2_000)
                }
            }
        case "chart":
            try checkKeys(data, path: path, allowed: ["kind", "series"], required: ["kind", "series"])
            let kind = try string(data["kind"], path: "\(path).kind", min: 1, max: 20)
            guard ["line", "bar", "area"].contains(kind) else { throw invalid("\(path).kind", "must be line, bar or area") }
            let series = try array(
                data["series"],
                path: "\(path).series",
                min: 1,
                max: GeneratedViewLimits.chartSeries
            )
            var pointCount = 0
            for (seriesIndex, seriesValue) in series.enumerated() {
                let seriesPath = "\(path).series[\(seriesIndex)]"
                let item = try object(seriesValue, path: seriesPath)
                try checkKeys(item, path: seriesPath, allowed: ["name", "points"], required: ["name", "points"])
                _ = try string(item["name"], path: "\(seriesPath).name", min: 1, max: 100)
                let points = try array(
                    item["points"],
                    path: "\(seriesPath).points",
                    min: 0,
                    max: GeneratedViewLimits.chartPoints
                )
                pointCount += points.count
                guard pointCount <= GeneratedViewLimits.chartPoints else {
                    throw invalid("\(path).series", "must contain at most 1000 points in total")
                }
                for (pointIndex, pointValue) in points.enumerated() {
                    let pointPath = "\(seriesPath).points[\(pointIndex)]"
                    let point = try object(pointValue, path: pointPath)
                    try checkKeys(point, path: pointPath, allowed: ["x", "y"], required: ["x", "y"])
                    switch point["x"] {
                    case .number?: break
                    case .string(let x)? where x.utf16.count <= 200: break
                    default: throw invalid("\(pointPath).x", "must be a number or string of at most 200 characters")
                    }
                    guard case .number? = point["y"] else { throw invalid("\(pointPath).y", "must be a number") }
                }
            }
        case "task-card":
            try checkKeys(data, path: path, allowed: ["id", "title", "state", "summary"], required: ["id", "title", "state"])
            _ = try string(data["id"], path: "\(path).id", min: 1, max: 64)
            _ = try string(data["title"], path: "\(path).title", min: 1, max: 200)
            _ = try string(data["state"], path: "\(path).state", min: 1, max: 50)
            if let summary = data["summary"] { _ = try string(summary, path: "\(path).summary", min: 0, max: 2_000) }
        case "status":
            try checkKeys(data, path: path, allowed: ["label", "value", "state"], required: ["label", "state"])
            _ = try string(data["label"], path: "\(path).label", min: 1, max: 100)
            let state = try string(data["state"], path: "\(path).state", min: 1, max: 20)
            guard ["ok", "warning", "error", "unknown"].contains(state) else {
                throw invalid("\(path).state", "must be ok, warning, error or unknown")
            }
            if let value = data["value"] { _ = try string(value, path: "\(path).value", min: 0, max: 500) }
        case "image":
            try checkKeys(data, path: path, allowed: ["images"], required: ["images"])
            let images = try array(data["images"], path: "\(path).images", min: 0, max: 10)
            for (index, imageValue) in images.enumerated() {
                let imagePath = "\(path).images[\(index)]"
                let image = try object(imageValue, path: imagePath)
                try checkKeys(image, path: imagePath, allowed: ["url", "alt"], required: ["url", "alt"])
                let url = try string(image["url"], path: "\(imagePath).url", min: 1, max: 2_000)
                guard safeHTTPS(
                    url,
                    hosts: ["github.com", "raw.githubusercontent.com", "avatars.githubusercontent.com"],
                    allowAzureSubdomains: false,
                    trustedBlobHost: trustedBlobHost
                ) else {
                    throw invalid("\(imagePath).url", "must be a safe HTTPS image URL")
                }
                _ = try string(image["alt"], path: "\(imagePath).alt", min: 1, max: 500)
            }
        case "html-app":
            try checkKeys(data, path: path, allowed: ["artifactId"], required: ["artifactId"])
            let artifactID = try string(data["artifactId"], path: "\(path).artifactId", min: 1, max: 36)
            guard matches(uuidV4Pattern, artifactID) else { throw invalid("\(path).artifactId", "must be a UUID v4") }
        case "knowledge-graph":
            try checkKeys(data, path: path, allowed: ["query", "highlight"], required: ["query", "highlight"])
            _ = try string(data["query"], path: "\(path).query", min: 1, max: 500, nonWhitespace: true)
            let highlights = try array(data["highlight"], path: "\(path).highlight", min: 0, max: 50)
            var seen = Set<String>()
            for (index, highlight) in highlights.enumerated() {
                let id = try string(highlight, path: "\(path).highlight[\(index)]", min: 64, max: 64)
                guard id.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
                    throw invalid("\(path).highlight[\(index)]", "must be a lowercase 64-character hexadecimal id")
                }
                guard seen.insert(id).inserted else { throw invalid("\(path).highlight[\(index)]", "must be unique") }
            }
        case "code":
            try validateCode(data, path: path)
        default:
            throw invalid(path, "uses an unsupported renderer")
        }
    }

    private static func validateCode(_ data: [String: JSONValue], path: String) throws {
        try checkKeys(
            data,
            path: path,
            allowed: ["repo", "path", "ref", "language", "content", "startLine", "highlight", "query"],
            required: ["repo", "path", "content"]
        )
        _ = try string(data["repo"], path: "\(path).repo", min: 1, max: 200, nonWhitespace: true)
        _ = try string(data["path"], path: "\(path).path", min: 1, max: 2_048, nonWhitespace: true)
        for (key, limit) in [("ref", 200), ("language", 64), ("query", 500)] {
            if let value = data[key] {
                _ = try string(value, path: "\(path).\(key)", min: 1, max: limit, nonWhitespace: true)
            }
        }
        let content = try string(data["content"], path: "\(path).content", min: 0, max: 200_000)
        let lineCount = content
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
            .count
        let startLine: Int
        if let value = data["startLine"] {
            startLine = try integer(value, path: "\(path).startLine", minimum: 1, maximum: 9_007_199_254_740_991)
        } else {
            startLine = 1
        }
        guard lineCount <= 400, startLine <= 9_007_199_254_740_991 - lineCount else {
            throw invalid("\(path).content", "must contain at most 400 lines with a safe line range")
        }
        if let highlightsValue = data["highlight"] {
            let endLine = startLine + lineCount - 1
            let highlights = try array(highlightsValue, path: "\(path).highlight", min: 0, max: 400)
            for (index, rangeValue) in highlights.enumerated() {
                let rangePath = "\(path).highlight[\(index)]"
                let range = try object(rangeValue, path: rangePath)
                try checkKeys(range, path: rangePath, allowed: ["from", "to"], required: ["from", "to"])
                let from = try integer(range["from"], path: "\(rangePath).from", minimum: 1, maximum: 9_007_199_254_740_991)
                let to = try integer(range["to"], path: "\(rangePath).to", minimum: 1, maximum: 9_007_199_254_740_991)
                guard from >= startLine, to >= from, to <= endLine else {
                    throw invalid(rangePath, "must be an inclusive range within the displayed lines")
                }
            }
        }
    }

    private static func validateLabelValue(_ value: JSONValue, path: String) throws {
        let object = try object(value, path: path)
        try checkKeys(object, path: path, allowed: ["label", "value"], required: ["label", "value"])
        _ = try string(object["label"], path: "\(path).label", min: 1, max: 100)
        _ = try string(object["value"], path: "\(path).value", min: 0, max: 2_000)
    }

    private static func validateWindowAction(_ action: [String: JSONValue], path: String) throws {
        try checkKeys(
            action,
            path: path,
            allowed: ["type", "operation", "windowId", "x", "y", "width", "height"],
            required: ["type", "operation", "windowId"]
        )
        let operation = try string(action["operation"], path: "\(path).operation", min: 1, max: 20)
        _ = try string(action["windowId"], path: "\(path).windowId", min: 1, max: 64)
        switch operation {
        case "focus", "minimise", "restore", "close":
            guard action["x"] == nil, action["y"] == nil, action["width"] == nil, action["height"] == nil else {
                throw invalid(path, "must not include coordinates for this operation")
            }
        case "move":
            _ = try number(action["x"], path: "\(path).x", minimum: 0, maximum: 10_000)
            _ = try number(action["y"], path: "\(path).y", minimum: 0, maximum: 10_000)
            guard action["width"] == nil, action["height"] == nil else {
                throw invalid(path, "must not include width or height for move")
            }
        case "resize":
            _ = try number(action["width"], path: "\(path).width", minimum: Double.leastNonzeroMagnitude, maximum: 10_000)
            _ = try number(action["height"], path: "\(path).height", minimum: Double.leastNonzeroMagnitude, maximum: 10_000)
            if action["x"] != nil { _ = try number(action["x"], path: "\(path).x", minimum: 0, maximum: 10_000) }
            if action["y"] != nil { _ = try number(action["y"], path: "\(path).y", minimum: 0, maximum: 10_000) }
        default:
            throw invalid("\(path).operation", "must be focus, minimise, restore, close, move or resize")
        }
    }

    private static func array(_ value: JSONValue?, path: String, min: Int, max: Int) throws -> [JSONValue] {
        guard case .array(let array)? = value else { throw invalid(path, "must be an array") }
        guard array.count >= min, array.count <= max else {
            throw invalid(path, "must contain \(min)-\(max) items")
        }
        return array
    }

    private static func integer(_ value: JSONValue?, path: String, minimum: Int, maximum: Int) throws -> Int {
        guard case .number(let number)? = value,
              number.isFinite,
              number.rounded(.towardZero) == number,
              number >= Double(minimum),
              number <= Double(maximum),
              number <= Double(Int.max),
              number >= Double(Int.min) else {
            throw invalid(path, "must be an integer from \(minimum) to \(maximum)")
        }
        return Int(number)
    }

    private static func number(_ value: JSONValue?, path: String, minimum: Double, maximum: Double) throws -> Double {
        guard case .number(let number)? = value, number.isFinite, number >= minimum, number <= maximum else {
            throw invalid(path, "must be a number from \(minimum) to \(maximum)")
        }
        return number
    }

    private static func dateTime(_ value: JSONValue?, path: String) throws -> String {
        let value = try string(value, path: path, min: 1, max: 100)
        guard isISODateTime(value) else {
            throw invalid(path, "must be an ISO date-time")
        }
        return value
    }

    private static func isISODateTime(_ value: String) -> Bool {
        let pattern = #"^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})$"#
        guard value.range(of: pattern, options: .regularExpression) != nil else { return false }
        var normalized = value.replacingOccurrences(of: "t", with: "T")
            .replacingOccurrences(of: " ", with: "T")
            .replacingOccurrences(of: "z", with: "Z")
        if normalized.range(of: #"[+-]\d{4}$"#, options: .regularExpression) != nil {
            let split = normalized.index(normalized.endIndex, offsetBy: -2)
            normalized.insert(":", at: split)
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if formatter.date(from: normalized) != nil { return true }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: normalized) != nil
    }

    private static func validateTimelineDate(_ value: JSONValue, path: String) throws {
        let value = try string(value, path: path, min: 1, max: 100)
        if value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
                throw invalid(path, "must be a real ISO date")
            }
            return
        }
        _ = try dateTime(.string(value), path: path)
    }

    private static func safeHTTPS(
        _ value: String,
        hosts: Set<String>,
        allowAzureSubdomains: Bool,
        trustedBlobHost: String? = nil
    ) -> Bool {
        guard let components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(),
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.port == nil || components.port == 443 else { return false }
        let trustedBlobHostIsValid = trustedBlobHost?.range(
            of: #"^[a-z0-9]{3,24}\.blob\.core\.windows\.net$"#,
            options: .regularExpression
        ) != nil
        return hosts.contains(host) ||
            (allowAzureSubdomains && (host == "azure.com" || host.hasSuffix(".azure.com"))) ||
            (trustedBlobHostIsValid && host == trustedBlobHost)
    }

    private static func serializedJSONByteCount(_ value: JSONValue) -> Int {
        switch value {
        case .null:
            return 4
        case .bool(let value):
            return value ? 4 : 5
        case .number(let value):
            return javascriptNumberString(value).utf8.count
        case .string(let value):
            return serializedJSONStringByteCount(value)
        case .array(let values):
            return 2 + values.reduce(0) { $0 + serializedJSONByteCount($1) } + max(values.count - 1, 0)
        case .object(let values):
            return 2 + values.reduce(0) { count, entry in
                count + serializedJSONStringByteCount(entry.key) + 1 + serializedJSONByteCount(entry.value)
            } + max(values.count - 1, 0)
        }
    }

    private static func serializedJSONStringByteCount(_ value: String) -> Int {
        value.unicodeScalars.reduce(2) { count, scalar in
            switch scalar.value {
            case 0x08, 0x09, 0x0A, 0x0C, 0x0D, 0x22, 0x5C:
                return count + 2
            case 0x00...0x1F:
                return count + 6
            default:
                return count + String(scalar).utf8.count
            }
        }
    }

    private static func javascriptNumberString(_ value: Double) -> String {
        guard value != 0 else { return "0" }
        let isNegative = value < 0
        let raw = String(abs(value)).lowercased()
        let exponentParts = raw.split(separator: "e", maxSplits: 1).map(String.init)
        let mantissa = exponentParts[0]
        let exponent = exponentParts.count == 2 ? Int(exponentParts[1]) ?? 0 : 0
        let decimalPosition = (mantissa.firstIndex(of: ".").map {
            mantissa.distance(from: mantissa.startIndex, to: $0)
        } ?? mantissa.count) + exponent
        var digits = mantissa.filter(\.isNumber)
        while digits.count > 1, digits.last == "0" { digits.removeLast() }
        let magnitude = abs(value)
        let number: String
        if magnitude >= 1e-6, magnitude < 1e21 {
            if decimalPosition <= 0 {
                number = "0." + String(repeating: "0", count: -decimalPosition) + digits
            } else if decimalPosition >= digits.count {
                number = digits + String(repeating: "0", count: decimalPosition - digits.count)
            } else {
                let split = digits.index(digits.startIndex, offsetBy: decimalPosition)
                number = String(digits[..<split]) + "." + String(digits[split...])
            }
        } else {
            let significant = String(digits.drop(while: { $0 == "0" }).reversed().drop(while: { $0 == "0" }).reversed())
            let scientificExponent = decimalPosition - 1
            let fraction = significant.count > 1 ? "." + significant.dropFirst() : ""
            number = String(significant.prefix(1)) + fraction + "e" +
                (scientificExponent >= 0 ? "+" : "") + String(scientificExponent)
        }
        return isNegative ? "-" + number : number
    }

    private static func validHTMLArtifactTimestamp(_ value: String) -> Bool {
        guard value.range(
            of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#,
            options: .regularExpression
        ) != nil else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }

    private static func checkKeys(
        _ object: [String: JSONValue],
        path: String,
        allowed: Set<String>,
        required: Set<String>
    ) throws {
        if let extra = object.keys.first(where: { !allowed.contains($0) }) {
            throw invalid("\(path).\(extra)", "is not allowed")
        }
        if let missing = required.first(where: { object[$0] == nil }) {
            throw invalid("\(path).\(missing)", "is required")
        }
    }

    private static func matches(_ expression: NSRegularExpression, _ value: String) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return expression.firstMatch(in: value, range: range) != nil
    }

    private static func invalid(_ path: String, _ reason: String) -> GeneratedViewValidationError {
        .invalid(path: path, reason: reason)
    }
}

private extension JSONValue {
    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }
}
