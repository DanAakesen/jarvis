import Foundation

public final class JarvisWorkspaceClient: Sendable {
    private static let maximumEventSize = 320 * 1024
    private static let maximumHTMLArtifactResponseSize = GeneratedViewLimits.htmlArtifactBytes + 128 * 1024

    private let client: JarvisClient
    private let policy: WorkspaceReconnectPolicy
    private let clock: any WorkspaceClock
    private let connection = WorkspaceConnectionState()

    public init(
        client: JarvisClient,
        reconnectPolicy: WorkspaceReconnectPolicy = WorkspaceReconnectPolicy(),
        clock: any WorkspaceClock = ContinuousWorkspaceClock()
    ) {
        self.client = client
        self.policy = reconnectPolicy
        self.clock = clock
    }

    public func events() -> AsyncThrowingStream<WorkspaceEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var attempt = 0
                do {
                    while !Task.isCancelled {
                        await connection.clear()
                        do {
                            let response = try await client.performChatStream(
                                method: .get,
                                path: ["now", "events"]
                            )
                            attempt = 0
                            try await consume(response, continuation: continuation)
                        } catch {
                            await connection.clear()
                            guard Self.shouldReconnect(after: error) else { throw error }
                            continuation.yield(.connectionInterrupted)
                        }

                        guard !Task.isCancelled else { break }
                        attempt += 1
                        try await clock.sleep(for: policy.delay(afterAttempt: attempt))
                    }
                    await connection.clear()
                    continuation.finish()
                } catch {
                    await connection.clear()
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
                Task { await self.connection.clear() }
            }
        }
    }

    public func register(_ snapshot: WorkspaceSnapshot) async throws {
        guard Self.valid(snapshot) else { throw JarvisWorkspaceClientError.invalidSnapshot }
        guard let sessionId = await connection.currentSessionID() else {
            throw JarvisWorkspaceClientError.noActiveConnection
        }
        let body: Data
        do {
            body = try JSONEncoder().encode(WorkspaceRegisterRequest(
                sessionId: sessionId,
                windows: snapshot.windows,
                contextPanelOpen: snapshot.contextPanelOpen,
                device: snapshot.device
            ))
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
        do {
            let response = try await client.performAuthenticatedRequest(
                method: .post,
                path: ["now", "workspace", "state"],
                body: body,
                idempotent: false
            )
            guard response.statusCode == 204 else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
        } catch let error as JarvisClientError {
            if case .httpStatus(400) = error {
                throw JarvisWorkspaceClientError.invalidSnapshot
            }
            if case .httpStatus(409) = error {
                await connection.clear(ifSessionID: sessionId)
                throw JarvisWorkspaceClientError.staleConnection
            }
            throw error
        }
    }

    public func htmlArtifact(id: String) async throws -> HtmlArtifact {
        guard Self.validArtifactID(id) else {
            throw JarvisWorkspaceClientError.invalidResponse
        }
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["factory", "workspace-artifacts", "html", id],
            idempotent: true
        )
        guard response.statusCode == 200,
              response.body.count <= Self.maximumHTMLArtifactResponseSize,
              let artifact = try? JSONDecoder().decode(HtmlArtifact.self, from: response.body),
              artifact.id.caseInsensitiveCompare(id) == .orderedSame else {
            throw JarvisWorkspaceClientError.invalidResponse
        }
        return artifact
    }

    public func acknowledge(
        commandId: String,
        expiresAtMilliseconds: Int64,
        applied: Bool,
        outcome: WorkspaceCommandOutcome? = nil,
        reason: String? = nil
    ) async throws {
        guard Self.validCommandID(commandId),
              expiresAtMilliseconds > 0,
              reason.map(Self.validReason) ?? true else {
            throw JarvisWorkspaceClientError.invalidAcknowledgement
        }
        guard let sessionId = await connection.currentSessionID() else {
            throw JarvisWorkspaceClientError.noActiveConnection
        }
        let now = await clock.now()
        let remainingMilliseconds = Double(expiresAtMilliseconds) - now.timeIntervalSince1970 * 1_000
        guard remainingMilliseconds >= 1,
              remainingMilliseconds.isFinite,
              remainingMilliseconds < Double(Int64.max) else {
            throw JarvisWorkspaceClientError.acknowledgementExpired
        }
        let requestTimeout = Duration.milliseconds(Int64(remainingMilliseconds.rounded(.down)))
        let body: Data
        do {
            body = try JSONEncoder().encode(WorkspaceAcknowledgementRequest(
                sessionId: sessionId,
                applied: applied,
                outcome: outcome,
                reason: reason
            ))
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
        do {
            let response = try await client.performAuthenticatedRequest(
                method: .post,
                path: ["now", "workspace", "commands", commandId, "ack"],
                body: body,
                idempotent: false,
                timeout: requestTimeout
            )
            guard response.statusCode == 204 else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error {
                throw JarvisWorkspaceClientError.commandNoLongerPending
            }
            if case .httpStatus(409) = error {
                await connection.clear(ifSessionID: sessionId)
                throw JarvisWorkspaceClientError.staleConnection
            }
            throw error
        }
    }

    private func consume(
        _ response: HTTPStreamResponse,
        continuation: AsyncThrowingStream<WorkspaceEvent, any Error>.Continuation
    ) async throws {
        var parser = SSEParser()
        for try await bytes in response.body {
            try Task.checkCancellation()
            for event in parser.append(bytes) {
                try await emit(event, continuation: continuation)
            }
        }
        for event in parser.finish() {
            try await emit(event, continuation: continuation)
        }
    }

    private func emit(
        _ event: ServerSentEvent,
        continuation: AsyncThrowingStream<WorkspaceEvent, any Error>.Continuation
    ) async throws {
        guard event.data.utf8.count <= Self.maximumEventSize else {
            throw JarvisWorkspaceClientError.invalidResponse
        }
        let decoded: WorkspaceEvent
        switch event.name {
        case "now", "refresh", "mode":
            decoded = .pendingConfirmationsChanged
        case "jarvis-activity", "job":
            decoded = .activityChanged
        case "status":
            guard let status = try? JSONDecoder().decode(WorkspaceStatusEvent.self, from: Data(event.data.utf8)) else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
            if status.kind == "approval_pending" {
                decoded = .pendingConfirmationsChanged
            } else {
                decoded = .unknown(name: event.name, data: event.data)
            }
        case "workspace-ready":
            guard let ready = try? JSONDecoder().decode(WorkspaceReadyEvent.self, from: Data(event.data.utf8)),
                  Self.validSessionID(ready.sessionId),
                  ready.trustedBlobHost.map(Self.validTrustedBlobHost) ?? true else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
            await connection.setSessionID(ready.sessionId, trustedBlobHost: ready.trustedBlobHost)
            decoded = .workspaceReady(sessionId: ready.sessionId, trustedBlobHost: ready.trustedBlobHost)
        case "workspace-command":
            guard let command = try? JSONDecoder().decode(WorkspaceCommandEvent.self, from: Data(event.data.utf8)),
                  command.expiresAtMilliseconds > 0 else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
            decoded = .workspaceCommand(
                command: command.command,
                expiresAtMilliseconds: command.expiresAtMilliseconds,
                trustedBlobHost: await connection.currentTrustedBlobHost()
            )
        case "workspace-cancel":
            guard let cancelled = try? JSONDecoder().decode(WorkspaceCancelEvent.self, from: Data(event.data.utf8)),
                  Self.validCommandID(cancelled.commandId) else {
                throw JarvisWorkspaceClientError.invalidResponse
            }
            decoded = .workspaceCancel(commandId: cancelled.commandId)
        default:
            decoded = .unknown(name: event.name, data: event.data)
        }
        continuation.yield(decoded)
    }

    private static func shouldReconnect(after error: any Error) -> Bool {
        if error is HTTPTransportFailure { return true }
        guard let error = error as? JarvisClientError else { return false }
        switch error {
        case .networkFailure, .timedOut, .serviceUnavailable, .rateLimited:
            return true
        default:
            return false
        }
    }

    private static func valid(_ snapshot: WorkspaceSnapshot) -> Bool {
        snapshot.windows.count <= 32 &&
            snapshot.windows.allSatisfy { window in
                window.viewId.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil &&
                    !window.title.isEmpty &&
                    window.title.utf16.count <= 200
            } &&
            (snapshot.device?.label.map { !$0.isEmpty && $0.utf16.count <= 60 } ?? true)
    }

    private static func validReason(_ reason: String) -> Bool {
        !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            reason.utf16.count <= 300 &&
            reason.unicodeScalars.allSatisfy { !((0x00...0x1F).contains($0.value) || $0.value == 0x7F) }
    }

    private static func validCommandID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }

    private static func validSessionID(_ value: String) -> Bool {
        value.range(
            of: #"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$"#,
            options: .regularExpression
        ) != nil
    }

    private static func validArtifactID(_ value: String) -> Bool {
        validSessionID(value)
    }

    private static func validTrustedBlobHost(_ value: String) -> Bool {
        value.range(
            of: #"^[a-z0-9]{3,24}\.blob\.core\.windows\.net$"#,
            options: .regularExpression
        ) != nil
    }
}

private actor WorkspaceConnectionState {
    private var sessionId: String?
    private var trustedBlobHost: String?

    func currentSessionID() -> String? { sessionId }
    func currentTrustedBlobHost() -> String? { trustedBlobHost }
    func setSessionID(_ value: String, trustedBlobHost: String?) {
        sessionId = value
        self.trustedBlobHost = trustedBlobHost
    }
    func clear() {
        sessionId = nil
        trustedBlobHost = nil
    }

    func clear(ifSessionID value: String) {
        if sessionId == value { clear() }
    }
}

private struct WorkspaceRegisterRequest: Encodable {
    let sessionId: String
    let windows: [WorkspaceWindow]
    let contextPanelOpen: Bool
    let device: WorkspaceDevice?
}

private struct WorkspaceAcknowledgementRequest: Encodable {
    let sessionId: String
    let applied: Bool
    let outcome: WorkspaceCommandOutcome?
    let reason: String?
}

private struct WorkspaceReadyEvent: Decodable {
    let sessionId: String
    let trustedBlobHost: String?
}

private struct WorkspaceCommandEvent: Decodable {
    let command: WorkspaceCommand
    let expiresAtMilliseconds: Int64

    enum CodingKeys: String, CodingKey {
        case command
        case expiresAtMilliseconds = "expiresAt"
    }
}

private struct WorkspaceCancelEvent: Decodable {
    let commandId: String
}

private struct WorkspaceStatusEvent: Decodable {
    let kind: String
}
