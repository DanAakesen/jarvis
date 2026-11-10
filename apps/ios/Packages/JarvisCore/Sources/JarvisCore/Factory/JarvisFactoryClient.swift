import Foundation

public enum JarvisFactoryClientError: Error, Equatable, Sendable {
    case invalidRequest
    case invalidResponse
    case confirmationRequired(reason: String, message: String)
    case taskConflict(String)
    case taskNotFound
}

public struct FactoryBoardUpdate: Codable, Equatable, Sendable {
    public let projectId: String
    public let version: Int
}

public final class JarvisFactoryClient: Sendable {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func projects() async throws -> [FactoryProject] {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "projects"],
            idempotent: true
        )
        return try Self.parseProjects(response)
    }

    /// Conditional reads for the repository layer. Validation matches the plain reads.
    public func fetchProjects(validator: String?) async throws -> JarvisFetchResult<[FactoryProject]> {
        try await client.conditionalGet(path: ["factory", "projects"], validator: validator) {
            try Self.parseProjects($0)
        }
    }

    public func fetchBoard(projectId: String, validator: String?) async throws -> JarvisFetchResult<FactoryBoard> {
        guard isValidFactoryID(projectId) else { throw JarvisFactoryClientError.invalidRequest }
        return try await client.conditionalGet(
            path: ["factory", "board"],
            queryItems: [URLQueryItem(name: "project", value: projectId)],
            validator: validator
        ) { try Self.parseBoard($0, projectId: projectId) }
    }

    private static func parseProjects(_ response: HTTPResponse) throws -> [FactoryProject] {
        guard response.statusCode == 200,
              response.body.count <= maximumResponseBytes,
              let projects = try? JSONDecoder().decode([FactoryProject].self, from: response.body),
              projects.count <= 100,
              projects.allSatisfy({ isValidFactoryID($0.id) && !$0.name.isEmpty }) else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return projects
    }

    private static func parseBoard(_ response: HTTPResponse, projectId: String) throws -> FactoryBoard {
        guard response.statusCode == 200,
              response.body.count <= maximumResponseBytes,
              let board = try? JSONDecoder().decode(FactoryBoard.self, from: response.body),
              board.project.id == projectId,
              board.columns.count == FactoryBoardColumnID.allCases.count,
              board.columns.allSatisfy({ $0.cards.count <= 1_000 }) else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return board
    }

    public func board(projectId: String) async throws -> FactoryBoard {
        guard isValidFactoryID(projectId) else { throw JarvisFactoryClientError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "board"],
            queryItems: [URLQueryItem(name: "project", value: projectId)],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let board = try? JSONDecoder().decode(FactoryBoard.self, from: response.body),
              board.project.id == projectId,
              board.columns.count == FactoryBoardColumnID.allCases.count,
              board.columns.allSatisfy({ $0.cards.count <= 1_000 }) else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return board
    }

    public func tasks(
        projectId: String,
        agent: FactoryAgent? = nil,
        state: FactoryTaskState? = nil,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> FactoryTaskList {
        guard isValidFactoryID(projectId), (1...100).contains(limit), (0...10_000).contains(offset) else {
            throw JarvisFactoryClientError.invalidRequest
        }
        var query = [
            URLQueryItem(name: "projectId", value: projectId),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let agent { query.append(URLQueryItem(name: "agent", value: agent.rawValue)) }
        if let state { query.append(URLQueryItem(name: "state", value: state.rawValue)) }
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "tasks"],
            queryItems: query,
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let list = try? JSONDecoder().decode(FactoryTaskList.self, from: response.body),
              list.tasks.count <= limit,
              list.limit == limit,
              list.offset == offset else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return list
    }

    public func task(id: String, eventLimit: Int = 100, eventOffset: Int = 0) async throws -> FactoryTaskDetail {
        guard isValidFactoryID(id), (1...200).contains(eventLimit), (0...10_000).contains(eventOffset) else {
            throw JarvisFactoryClientError.invalidRequest
        }
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "tasks", id],
            queryItems: [
                URLQueryItem(name: "eventLimit", value: String(eventLimit)),
                URLQueryItem(name: "eventOffset", value: String(eventOffset)),
            ],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let detail = try? JSONDecoder().decode(FactoryTaskDetail.self, from: response.body),
              detail.task.id == id,
              detail.events.count <= eventLimit,
              detail.usage.count <= 2_000 else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return detail
    }

    public func createTask(_ submission: FactoryTaskSubmission) async throws -> FactoryTaskRecord {
        guard submission.isValid else { throw JarvisFactoryClientError.invalidRequest }
        let body = try JSONEncoder().encode(submission)
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["factory", "tasks"],
            body: body,
            idempotent: false
        )
        guard response.statusCode == 201,
              response.body.count <= Self.maximumResponseBytes,
              let task = try? JSONDecoder().decode(FactoryTaskRecord.self, from: response.body),
              task.projectId == submission.projectId else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return task
    }

    public func updatePolicy(projectId: String, policy: FactoryProjectPolicy) async throws -> FactoryProject {
        guard isValidFactoryID(projectId) else { throw JarvisFactoryClientError.invalidRequest }
        let body = try JSONEncoder().encode(PolicyRequest(policy: policy))
        let response = try await client.performAuthenticatedRequest(
            method: .patch,
            path: ["factory", "projects", projectId],
            body: body,
            idempotent: false
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let project = try? JSONDecoder().decode(FactoryProject.self, from: response.body),
              project.id == projectId,
              project.policy == policy else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return project
    }

    public func controlTask(
        _ request: FactoryTaskControlRequest,
        confirm: Bool = false
    ) async throws -> FactoryTaskRecord {
        guard request.isValid else { throw JarvisFactoryClientError.invalidRequest }
        let body = try JSONEncoder().encode(ControlBody(
            action: request.action,
            message: request.message,
            confirm: confirm ? true : nil
        ))
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["factory", "tasks", request.taskId, "controls"],
            body: body,
            idempotent: false,
            additionalSuccessStatuses: [409]
        )
        if response.statusCode == 409 {
            guard response.body.count <= Self.maximumResponseBytes,
                  let failure = try? JSONDecoder().decode(ControlFailure.self, from: response.body) else {
                throw JarvisFactoryClientError.invalidResponse
            }
            if failure.confirmationRequired == true {
                throw JarvisFactoryClientError.confirmationRequired(
                    reason: failure.reason ?? "",
                    message: failure.error
                )
            }
            throw JarvisFactoryClientError.taskConflict(failure.error)
        }
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let task = try? JSONDecoder().decode(FactoryTaskRecord.self, from: response.body),
              task.id == request.taskId else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return task
    }

    public func retryTask(id: String) async throws -> FactoryTaskRecord {
        guard isValidFactoryID(id) else { throw JarvisFactoryClientError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["factory", "tasks", id, "retry"],
            idempotent: false
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let task = try? JSONDecoder().decode(FactoryTaskRecord.self, from: response.body),
              task.id == id else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return task
    }

    /// The deployed models, for the optional Model and Reasoning choices on a new task.
    public func deployedModels() async throws -> [JarvisModelDeployment] {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["models"],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let catalogue = try? JSONDecoder().decode(JarvisModelCatalogue.self, from: response.body),
              catalogue.deployments.count <= 200 else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return catalogue.deployments
    }

    public func releases(projectId: String) async throws -> FactoryReleaseView {
        guard isValidFactoryID(projectId) else { throw JarvisFactoryClientError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "projects", projectId, "releases"],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumResponseBytes,
              let view = try? JSONDecoder().decode(FactoryReleaseView.self, from: response.body),
              view.project.id == projectId,
              view.releases.count <= 1_000,
              view.workflowRuns.count <= 2_000,
              view.deployments.count <= 2_000,
              (view.graph?.commits.count ?? 0) <= 2_000 else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return view
    }

    /// `onConnected` runs once the stream is open, so the caller can tell an established connection from a failed
    /// one even when no board event arrives for a while.
    public func listenForBoardUpdates(
        onConnected: () async -> Void = {},
        _ receive: (FactoryBoardUpdate) async -> Void
    ) async throws {
        let response = try await client.performChatStream(
            method: .get,
            path: ["now", "events"],
            accept: "text/event-stream",
            headers: [:]
        )
        await onConnected()
        var parser = SSEParser()
        for try await chunk in response.body {
            for event in parser.append(chunk) {
                guard event.data.utf8.count <= Self.maximumEventBytes else {
                    throw JarvisFactoryClientError.invalidResponse
                }
                guard event.name == "board" else { continue }
                let update = try Self.decode(FactoryBoardUpdate.self, from: event.data)
                guard isValidFactoryID(update.projectId), update.version >= 1 else {
                    throw JarvisFactoryClientError.invalidResponse
                }
                await receive(update)
            }
        }
        for event in parser.finish() where event.name == "board" {
            guard event.data.utf8.count <= Self.maximumEventBytes else {
                throw JarvisFactoryClientError.invalidResponse
            }
            let update = try Self.decode(FactoryBoardUpdate.self, from: event.data)
            guard isValidFactoryID(update.projectId), update.version >= 1 else {
                throw JarvisFactoryClientError.invalidResponse
            }
            await receive(update)
        }
    }

    public func listenForTaskEvents(
        taskId: String,
        after eventId: String? = nil,
        receive: (FactoryTaskEvent) async -> Void
    ) async throws {
        try await listenForTaskEventBatches(
            taskId: taskId, after: eventId, replayBatchSize: 1, onReplayComplete: {}
        ) { events, _ in
            for event in events { await receive(event) }
        }
    }

    /// Replay is delivered in bounded batches; live events are delivered immediately.
    /// `ready` covers active SQL events only, not archived HTTP history.
    public func listenForTaskEventBatches(
        taskId: String,
        after eventId: String? = nil,
        onReplayComplete: () async -> Void = {},
        receive: (_ events: [FactoryTaskEvent], _ replaying: Bool) async -> Void
    ) async throws {
        try await listenForTaskEventBatches(
            taskId: taskId, after: eventId,
            replayBatchSize: Self.maximumReplayBatchSize,
            onReplayComplete: onReplayComplete, receive: receive
        )
    }

    private func listenForTaskEventBatches(
        taskId: String,
        after eventId: String?,
        replayBatchSize: Int,
        onReplayComplete: () async -> Void,
        receive: (_ events: [FactoryTaskEvent], _ replaying: Bool) async -> Void
    ) async throws {
        guard isValidFactoryID(taskId),
              eventId.map({ $0.range(of: #"^(?:0|[1-9][0-9]{0,18})$"#, options: .regularExpression) != nil && Int64($0) != nil }) ?? true else {
            throw JarvisFactoryClientError.invalidRequest
        }
        let response = try await client.performChatStream(
            method: .get,
            path: ["factory", "tasks", taskId, "events"],
            accept: "text/event-stream",
            headers: eventId.map { ["Last-Event-ID": $0] } ?? [:]
        )
        var parser = SSEParser()
        var pending: [FactoryTaskEvent] = []
        var replaying = true
        func deliver(_ frames: [ServerSentEvent]) async throws {
            for event in frames {
                try Task.checkCancellation()
                guard event.data.utf8.count <= Self.maximumEventBytes else {
                    throw JarvisFactoryClientError.invalidResponse
                }
                if event.name == "ready" {
                    if !pending.isEmpty {
                        await receive(pending, replaying)
                        pending.removeAll(keepingCapacity: true)
                    }
                    if replaying {
                        replaying = false
                        await onReplayComplete()
                    }
                    continue
                }
                guard event.name == "task" else { continue }
                guard let id = event.id, isValidFactoryID(id) else {
                    throw JarvisFactoryClientError.invalidResponse
                }
                let taskEvent = try Self.decode(FactoryTaskEvent.self, from: event.data)
                guard taskEvent.taskId == taskId, taskEvent.id == id else {
                    throw JarvisFactoryClientError.invalidResponse
                }
                pending.append(taskEvent)
                if !replaying || pending.count == replayBatchSize {
                    await receive(pending, replaying)
                    pending.removeAll(keepingCapacity: true)
                    await Task.yield()
                }
            }
        }
        do {
            for try await chunk in response.body {
                try await deliver(parser.append(chunk))
            }
            try await deliver(parser.finish())
        } catch {
            // A short replay can fail before reaching a batch boundary. Retain all
            // validated events, but never treat a dropped stream as a ready signal.
            if !Task.isCancelled, !pending.isEmpty {
                await receive(pending, replaying)
            }
            throw error
        }
        if !pending.isEmpty { await receive(pending, replaying) }
    }

    private static let maximumReplayBatchSize = 100
    private static let maximumResponseBytes = 1024 * 1024
    private static let maximumEventBytes = 64 * 1024

    private static func decode<Value: Decodable>(_ type: Value.Type, from value: String) throws -> Value {
        guard let data = value.data(using: .utf8), let decoded = try? JSONDecoder().decode(type, from: data) else {
            throw JarvisFactoryClientError.invalidResponse
        }
        return decoded
    }
}

private struct PolicyRequest: Encodable {
    let policy: FactoryProjectPolicy
}

private struct ControlBody: Encodable {
    let action: FactoryTaskControl
    let message: String?
    let confirm: Bool?
}

private struct ControlFailure: Decodable {
    let error: String
    let reason: String?
    let confirmationRequired: Bool?
}
