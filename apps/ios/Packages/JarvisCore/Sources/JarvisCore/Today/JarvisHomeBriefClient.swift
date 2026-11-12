import Foundation

public struct JarvisHomeBrief: Codable, Equatable, Sendable {
    public let text: String
    public let state: String
    public let maxVisibleLines: Int
    public let generatedAt: String
    public let evidenceRefs: [String]
    public let unavailableSources: [String]
    public let highlights: [String]?

    public init(text: String, state: String = "generated", maxVisibleLines: Int = 3,
                generatedAt: String, evidenceRefs: [String] = [],
                unavailableSources: [String] = [], highlights: [String] = []) {
        self.text = text; self.state = state; self.maxVisibleLines = maxVisibleLines
        self.generatedAt = generatedAt; self.evidenceRefs = evidenceRefs
        self.unavailableSources = unavailableSources; self.highlights = highlights
    }
    public var greeting: JarvisTodayGreeting { .brief(text: text, highlights: highlights ?? []) }
    public var isValid: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 1200
            && (1...6).contains(maxVisibleLines) && ["generated", "unavailable"].contains(state)
            && evidenceRefs.count <= 12 && unavailableSources.count <= 5
            && (highlights?.allSatisfy { !$0.isEmpty && $0.count <= 160 && text.contains($0) } ?? true)
    }
}

public struct JarvisHomeBriefClient: Sendable {
    private let client: JarvisClient
    public init(client: JarvisClient) { self.client = client }

    public func fetch(refresh: Bool = false) async throws -> JarvisHomeBrief {
        var query: [URLQueryItem] = []
        if refresh { query.append(URLQueryItem(name: "refresh", value: "1")) }
        let response = try await client.performAuthenticatedRequest(
            method: .get, path: ["home", "brief"], queryItems: query, idempotent: true
        )
        guard response.body.count <= 32_000,
              let brief = try? JSONDecoder().decode(JarvisHomeBrief.self, from: response.body),
              brief.isValid else {
            throw JarvisClientError.responseDecodingFailure
        }
        return brief
    }
}
