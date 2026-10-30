import Foundation

public enum SavedWorkspaceKind: String, CaseIterable, Codable, Equatable, Sendable {
    case research
    case htmlApp = "html_app"
    case image
    case knowledgeGraph = "knowledge_graph"

    public var label: String {
        switch self {
        case .research: "Reports"
        case .htmlApp: "Apps"
        case .image: "Images"
        case .knowledgeGraph: "Graphs"
        }
    }
}

public struct SavedWorkspaceItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: SavedWorkspaceKind
    public let createdAt: String
    public let promptSummary: String
    public let pinned: Bool

    public init(
        id: String,
        title: String,
        kind: SavedWorkspaceKind,
        createdAt: String,
        promptSummary: String,
        pinned: Bool
    ) throws {
        guard Self.isValid(id: id, title: title, kind: kind, createdAt: createdAt, promptSummary: promptSummary) else {
            throw WorkspacesClientError.invalidItem
        }
        self.id = id
        self.title = title
        self.kind = kind
        self.createdAt = createdAt
        self.promptSummary = promptSummary
        self.pinned = pinned
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case title
        case kind
        case createdAt
        case promptSummary
        case pinned
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let title = try container.decode(String.self, forKey: .title)
        let kind = try container.decode(SavedWorkspaceKind.self, forKey: .kind)
        let createdAt = try container.decode(String.self, forKey: .createdAt)
        let promptSummary = try container.decode(String.self, forKey: .promptSummary)
        let pinned = try container.decode(Bool.self, forKey: .pinned)
        guard Self.isValid(id: id, title: title, kind: kind, createdAt: createdAt, promptSummary: promptSummary) else {
            throw WorkspacesClientError.invalidItem
        }
        self.id = id
        self.title = title
        self.kind = kind
        self.createdAt = createdAt
        self.promptSummary = promptSummary
        self.pinned = pinned
    }

    private static func isValid(
        id: String,
        title: String,
        kind: SavedWorkspaceKind,
        createdAt: String,
        promptSummary: String
    ) -> Bool {
        let idPattern = #"^(?:research|html_app|image|knowledge_graph):[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$"#
        guard id.range(of: idPattern, options: .regularExpression) != nil,
              id.hasPrefix("\(kind.rawValue):"),
              !title.isEmpty,
              title.utf16.count <= 200,
              promptSummary.utf16.count <= 500 else {
            return false
        }
        return Self.date(from: createdAt) != nil
    }

    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}

public struct SavedWorkspaceGroup: Equatable, Sendable {
    public let title: String
    public let items: [SavedWorkspaceItem]

    public init(title: String, items: [SavedWorkspaceItem]) {
        self.title = title
        self.items = items
    }
}

public enum SavedWorkspaceGrouping {
    public static func groups(_ items: [SavedWorkspaceItem], now: Date, calendar: Calendar = .current) -> [SavedWorkspaceGroup] {
        let startOfToday = calendar.startOfDay(for: now)
        let startOfWeek = calendar.date(byAdding: .day, value: -6, to: startOfToday) ?? startOfToday
        var grouped: [String: [SavedWorkspaceItem]] = [
            "Pinned": [],
            "Today": [],
            "This week": [],
            "Earlier": [],
        ]

        for item in items.sorted(by: newestFirst) {
            if item.pinned {
                grouped["Pinned", default: []].append(item)
                continue
            }
            guard let date = SavedWorkspaceItem.date(from: item.createdAt) else {
                grouped["Earlier", default: []].append(item)
                continue
            }
            let title = date >= startOfToday ? "Today" : date >= startOfWeek ? "This week" : "Earlier"
            grouped[title, default: []].append(item)
        }

        return ["Pinned", "Today", "This week", "Earlier"].compactMap { title in
            guard let values = grouped[title], !values.isEmpty else { return nil }
            return SavedWorkspaceGroup(title: title, items: values)
        }
    }

    private static func newestFirst(_ left: SavedWorkspaceItem, _ right: SavedWorkspaceItem) -> Bool {
        (SavedWorkspaceItem.date(from: left.createdAt) ?? .distantPast) >
            (SavedWorkspaceItem.date(from: right.createdAt) ?? .distantPast)
    }
}

public enum WorkspacesClientError: Error, Equatable, Sendable {
    case invalidItem
    case invalidResponse
    case itemNotFound
}

public final class JarvisWorkspacesClient: Sendable {
    public static let pageSize = 100

    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func search(
        query: String? = nil,
        kind: SavedWorkspaceKind? = nil,
        before: String? = nil
    ) async throws -> [SavedWorkspaceItem] {
        let trimmedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (trimmedQuery?.utf16.count ?? 0) <= 120,
              before.map({ SavedWorkspaceItem.date(from: $0) != nil }) ?? true else {
            throw JarvisClientError.invalidRequest
        }
        var queryItems: [URLQueryItem] = []
        if let trimmedQuery, !trimmedQuery.isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: trimmedQuery))
        }
        if let kind {
            queryItems.append(URLQueryItem(name: "kind", value: kind.rawValue))
        }
        if let before {
            queryItems.append(URLQueryItem(name: "before", value: before))
        }

        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["workspaces"],
            queryItems: queryItems,
            idempotent: true
        )
        let page: WorkspaceItemsResponse
        do {
            page = try JSONDecoder().decode(WorkspaceItemsResponse.self, from: response.body)
        } catch {
            throw WorkspacesClientError.invalidResponse
        }
        guard page.items.count <= Self.pageSize else { throw WorkspacesClientError.invalidResponse }
        return page.items
    }

    public func open(_ item: SavedWorkspaceItem) async throws -> SavedWorkspaceItem {
        try await sendItem(
            method: .post,
            path: ["workspaces", item.id, "open"],
            body: EmptyObject(),
            idempotent: false
        )
    }

    public func rename(_ item: SavedWorkspaceItem, title: String) async throws -> SavedWorkspaceItem {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf16.count <= 200 else {
            throw JarvisClientError.invalidRequest
        }
        return try await sendItem(
            method: .patch,
            path: ["workspaces", item.id],
            body: WorkspaceItemTitlePatch(title: trimmed),
            idempotent: false
        )
    }

    public func setPinned(_ item: SavedWorkspaceItem, pinned: Bool) async throws -> SavedWorkspaceItem {
        try await sendItem(
            method: .patch,
            path: ["workspaces", item.id],
            body: WorkspaceItemPinPatch(pinned: pinned),
            idempotent: false
        )
    }

    public func remove(_ item: SavedWorkspaceItem) async throws {
        let response: HTTPResponse
        do {
            response = try await client.performAuthenticatedRequest(
                method: .delete,
                path: ["workspaces", item.id],
                body: try JSONEncoder().encode(WorkspaceItemDeleteRequest(confirm: true)),
                idempotent: false
            )
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error { throw WorkspacesClientError.itemNotFound }
            throw error
        }
        guard let result = try? JSONDecoder().decode(WorkspaceItemDeleteResponse.self, from: response.body),
              result.deleted else {
            throw WorkspacesClientError.invalidResponse
        }
    }

    private func sendItem<Body: Encodable & Sendable>(
        method: HTTPMethod,
        path: [String],
        body: Body,
        idempotent: Bool
    ) async throws -> SavedWorkspaceItem {
        let encodedBody: Data
        do {
            encodedBody = try JSONEncoder().encode(body)
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
        let response: HTTPResponse
        do {
            response = try await client.performAuthenticatedRequest(
                method: method,
                path: path,
                body: encodedBody,
                idempotent: idempotent
            )
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error { throw WorkspacesClientError.itemNotFound }
            throw error
        }
        do {
            return try JSONDecoder().decode(SavedWorkspaceItem.self, from: response.body)
        } catch {
            throw WorkspacesClientError.invalidResponse
        }
    }
}

private struct WorkspaceItemsResponse: Decodable {
    let items: [SavedWorkspaceItem]
}

private struct EmptyObject: Encodable, Sendable {}

private struct WorkspaceItemTitlePatch: Encodable, Sendable {
    let title: String
}

private struct WorkspaceItemPinPatch: Encodable, Sendable {
    let pinned: Bool
}

private struct WorkspaceItemDeleteRequest: Encodable, Sendable {
    let confirm: Bool
}

private struct WorkspaceItemDeleteResponse: Decodable {
    let deleted: Bool
}
