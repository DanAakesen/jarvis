import Foundation

/// One explicit submission per unchanged draft. Transport failures never create a new task identity.
public struct WatchFactoryDraft: Hashable, Sendable {
    public let projectID: String
    public let title: String
    public let request: String
    public let agent: FactoryAgent
    public init(projectID: String, title: String, request: String, agent: FactoryAgent) {
        self.projectID = projectID
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.request = request.trimmingCharacters(in: .whitespacesAndNewlines)
        self.agent = agent
    }
    public func hash(into hasher: inout Hasher) {
        hasher.combine(projectID); hasher.combine(title); hasher.combine(request); hasher.combine(agent.rawValue)
    }
    public var isValid: Bool {
        request.utf8.count <= 8_000 && FactoryTaskSubmission(
            projectId: projectID, title: title, request: request, agent: agent
        ).isValid
    }
}

public struct WatchFactorySubmissions: Sendable {
    private var submissions: [WatchFactoryDraft: FactoryTaskSubmission] = [:]
    public init() {}
    public mutating func submission(for draft: WatchFactoryDraft) -> FactoryTaskSubmission? {
        guard draft.isValid else { return nil }
        if let previous = submissions[draft] { return previous }
        // Keep all attempted identities for this editor; never evict one and silently duplicate a retry.
        guard submissions.count < 32 else { return nil }
        let value = FactoryTaskSubmission(projectId: draft.projectID, title: draft.title,
                                          request: draft.request, agent: draft.agent)
        submissions[draft] = value
        return value
    }
}

public extension WatchRequest {
    var factorySubmission: FactoryTaskSubmission? {
        guard action == .createFactoryTask, let data,
              data.count <= WatchLimits.payloadBytes,
              let value = try? JSONDecoder().decode(FactoryTaskSubmission.self, from: data),
              value.isValid, value.request.utf8.count <= 8_000,
              value.projectId == itemID, UUID(uuidString: value.submissionId) == id,
              value.modelOverride == nil, value.reasoningOverride == nil else { return nil }
        return value
    }
}

public enum WatchHealthHistory {
    public static func items(from result: JarvisHealthQueryResult) throws -> [[String: JSONValue]] {
        guard result.status == "available" || (result.status == "empty" && result.items.isEmpty) else {
            throw WatchFailure.healthUnavailable
        }
        return result.items
    }
}
