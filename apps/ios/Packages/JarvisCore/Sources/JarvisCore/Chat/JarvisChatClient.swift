import Foundation

public final class JarvisChatClient: Sendable {
    private static let imageContentTypes = [
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "gif": "image/gif",
    ]
    private static let documentContentTypes = [
        "pdf": "application/pdf",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
        "json": "application/json",
        "log": "text/plain",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]

    private let client: JarvisClient
    private let reattachPolicy: ReattachPolicy
    private let clock: any ChatClock

    public init(
        client: JarvisClient,
        reattachPolicy: ReattachPolicy = ReattachPolicy(),
        clock: any ChatClock = ContinuousChatClock()
    ) {
        self.client = client
        self.reattachPolicy = reattachPolicy
        self.clock = clock
    }

    public func createSession(language: ChatLanguage) async throws -> ChatSession {
        let body = try encode(SessionRequest(channel: "chat", language: language))
        let response = try await client.performChatRequest(
            method: .post,
            path: ["conversation", "sessions"],
            body: body,
            idempotent: false
        )
        guard response.statusCode == 201,
              let session = try? JSONDecoder().decode(ChatSession.self, from: response.body),
              session.channel == .chat,
              session.language == language,
              Self.validID(session.id) else {
            throw JarvisChatClientError.invalidResponse
        }
        return session
    }

    public func sendTurn(
        sessionId: String,
        text: String,
        attachmentIds: [String] = [],
        screenContext: String? = nil
    ) async throws -> AsyncThrowingStream<ChatEvent, any Error> {
        try validateTurn(text: text, attachmentIds: attachmentIds, screenContext: screenContext)
        guard Self.validID(sessionId) else { throw JarvisChatClientError.invalidResponse }
        let body = try encode(SendTurnRequest(
            text: text,
            attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds,
            screenContext: screenContext
        ))
        let recoveryStart = await clock.now()
        let response = try await client.performChatStream(
            method: .post,
            path: ["conversation", "sessions", sessionId, "turns"],
            body: body
        )
        return eventStream(from: response, sessionId: sessionId, recoveryStart: recoveryStart)
    }

    public func listActiveTurns() async throws -> [ActiveChatTurn] {
        let response = try await client.performChatRequest(
            method: .get,
            path: ["conversation", "turns", "active"],
            idempotent: true
        )
        guard response.statusCode == 200,
              let turns = try? JSONDecoder().decode(ActiveTurnsResponse.self, from: response.body),
              turns.turns.allSatisfy({
                  Self.validID($0.sessionId) && Self.validID($0.messageId)
              }) else {
            throw JarvisChatClientError.invalidResponse
        }
        return turns.turns
    }

    public func reattachTurn(
        sessionId: String,
        messageId: String
    ) async throws -> AsyncThrowingStream<ChatEvent, any Error> {
        guard Self.validID(sessionId), Self.validID(messageId) else {
            throw JarvisChatClientError.invalidResponse
        }
        let start = await clock.now()
        let response = try await openReattachResponse(
            sessionId: sessionId,
            messageId: messageId,
            since: start
        )
        return eventStream(
            from: response,
            sessionId: sessionId,
            recoveryStart: start,
            messageId: messageId
        )
    }

    public func cancelTurn(sessionId: String, messageId: String) async throws -> Bool {
        guard Self.validID(sessionId), Self.validID(messageId) else {
            throw JarvisChatClientError.invalidResponse
        }
        do {
            let response = try await client.performChatRequest(
                method: .post,
                path: ["conversation", "sessions", sessionId, "turns", messageId, "cancel"],
                body: Data("{}".utf8),
                idempotent: false
            )
            guard response.statusCode == 200,
                  let result = try? JSONDecoder().decode(CancelTurnResponse.self, from: response.body),
                  result.cancelled else {
                throw JarvisChatClientError.invalidResponse
            }
            return true
        } catch let error as JarvisClientError {
            if case .httpStatus(404) = error { return false }
            throw error
        }
    }

    public func history(
        limit: Int = 50,
        before: String? = nil,
        sessionId: String? = nil
    ) async throws -> ChatHistoryPage {
        guard (1...100).contains(limit),
              before.map(Self.validID) ?? true,
              sessionId.map(Self.validID) ?? true else {
            throw JarvisChatClientError.invalidResponse
        }
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { queryItems.append(URLQueryItem(name: "before", value: before)) }
        if let sessionId { queryItems.append(URLQueryItem(name: "sessionId", value: sessionId)) }
        let response = try await client.performChatRequest(
            method: .get,
            path: ["conversation", "history"],
            queryItems: queryItems,
            idempotent: true
        )
        guard response.statusCode == 200,
              let page = try? JSONDecoder().decode(ChatHistoryPage.self, from: response.body),
              page.messages.allSatisfy({ Self.validID($0.id) && Self.validID($0.sessionId) }) else {
            throw JarvisChatClientError.invalidResponse
        }
        return page
    }

    public func uploadAttachment(_ upload: ChatAttachmentUpload) async throws -> ChatAttachmentDescriptor {
        let filename = upload.fileName.replacingOccurrences(of: "\\", with: "/")
        let basename = filename.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        let fileExtension = basename.split(separator: ".", omittingEmptySubsequences: false).last?.lowercased() ?? ""
        let expectedType = Self.imageContentTypes[fileExtension] ?? Self.documentContentTypes[fileExtension]
        let typeMatches = upload.contentType == expectedType ||
            fileExtension == "md" && upload.contentType == "text/plain" ||
            fileExtension == "csv" && upload.contentType == "application/csv"
        let maximumBytes = Self.imageContentTypes[fileExtension] == nil ? 20 * 1024 * 1024 : 10 * 1024 * 1024
        guard !upload.data.isEmpty, upload.data.count <= maximumBytes,
              !basename.isEmpty, basename.unicodeScalars.count <= 255,
              !upload.fileName.contains("\r"), !upload.fileName.contains("\n"),
              typeMatches else {
            throw JarvisChatClientError.invalidUpload
        }

        let boundary = "JarvisBoundary-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(Self.quotedFilename(upload.fileName))\"\r\n".utf8))
        body.append(Data("Content-Type: \(upload.contentType)\r\n\r\n".utf8))
        body.append(upload.data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        let response = try await client.performChatRequest(
            method: .post,
            path: ["conversation", "attachments"],
            headers: ["Accept": "application/json"],
            body: body,
            contentType: "multipart/form-data; boundary=\(boundary)",
            idempotent: false
        )
        guard response.statusCode == 201,
              let attachment = try? JSONDecoder().decode(ChatAttachmentDescriptor.self, from: response.body),
              Self.validUUID(attachment.id),
              attachment.size > 0,
              attachment.size <= 20 * 1024 * 1024 else {
            throw JarvisChatClientError.invalidResponse
        }
        return attachment
    }

    private func eventStream(
        from response: HTTPStreamResponse,
        sessionId: String,
        recoveryStart: Duration,
        messageId initialMessageId: String? = nil
    ) -> AsyncThrowingStream<ChatEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var response = response
                var acceptedMessageId = initialMessageId
                var previouslyReceived: [ServerSentEvent] = []
                var replayIndex = 0
                var isReplayConnection = false
                var receivedDone = false

                func emit(_ event: ServerSentEvent) throws -> Bool {
                    if isReplayConnection {
                        if replayIndex < previouslyReceived.count {
                            guard event == previouslyReceived[replayIndex] else {
                                throw JarvisChatClientError.invalidResponse
                            }
                            replayIndex += 1
                            return false
                        }
                        isReplayConnection = false
                    }

                    let chatEvent = try Self.decode(event: event, sessionId: sessionId)
                    if case .error(let failure) = chatEvent {
                        throw JarvisChatClientError.serverEvent(code: failure.code, message: failure.message)
                    }
                    if case .user(let message) = chatEvent { acceptedMessageId = message.id }
                    previouslyReceived.append(event)
                    continuation.yield(chatEvent)
                    if case .done = chatEvent { return true }
                    return false
                }

                do {
                    while !receivedDone {
                        var parser = SSEParser()
                        var receivedBytes = 0
                        do {
                            for try await chunk in response.body {
                                try Task.checkCancellation()
                                receivedBytes += chunk.count
                                guard receivedBytes <= 1024 * 1024 else {
                                    throw JarvisChatClientError.responseTooLarge
                                }
                                for event in parser.append(chunk) {
                                    if try emit(event) {
                                        receivedDone = true
                                        break
                                    }
                                }
                                if receivedDone { break }
                            }
                            if !receivedDone {
                                for event in parser.finish() {
                                    if try emit(event) {
                                        receivedDone = true
                                        break
                                    }
                                }
                            }
                            if !receivedDone { throw JarvisChatClientError.streamEnded }
                        } catch {
                            let mappedError = Self.mappedStreamError(error)
                            guard let acceptedMessageId, Self.shouldReattach(after: mappedError) else {
                                throw mappedError
                            }
                            try Task.checkCancellation()
                            try await waitForNextAttempt(since: recoveryStart)
                            response = try await openReattachResponse(
                                sessionId: sessionId,
                                messageId: acceptedMessageId,
                                since: recoveryStart
                            )
                            replayIndex = 0
                            isReplayConnection = true
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.mappedStreamError(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func openReattachResponse(
        sessionId: String,
        messageId: String,
        since start: Duration
    ) async throws -> HTTPStreamResponse {
        var firstAttempt = true
        while true {
            if !firstAttempt, await clock.now() - start >= reattachPolicy.maximumDuration {
                throw JarvisChatClientError.reattachTimedOut
            }
            try Task.checkCancellation()
            firstAttempt = false
            do {
                return try await client.performChatStream(
                    method: .get,
                    path: ["conversation", "sessions", sessionId, "turns", messageId, "events"]
                )
            } catch let error as JarvisClientError {
                if case .httpStatus(404) = error { throw JarvisChatClientError.turnNotFound }
                guard Self.isRetryable(error) else { throw error }
                try await waitForNextAttempt(since: start)
            } catch is CancellationError {
                throw CancellationError()
            }
        }
    }

    private func waitForNextAttempt(since start: Duration) async throws {
        let elapsed = await clock.now() - start
        let remaining = reattachPolicy.maximumDuration - elapsed
        guard remaining > .zero else { throw JarvisChatClientError.reattachTimedOut }
        try await clock.sleep(for: min(reattachPolicy.retryInterval, remaining))
    }

    private func validateTurn(text: String, attachmentIds: [String], screenContext: String?) throws {
        guard (1...20_000).contains(text.utf16.count),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw JarvisChatClientError.invalidTextLength
        }
        guard attachmentIds.count <= 5 else { throw JarvisChatClientError.tooManyAttachments }
        guard Set(attachmentIds).count == attachmentIds.count,
              attachmentIds.allSatisfy(Self.validUUID) else {
            throw JarvisChatClientError.invalidAttachmentIDs
        }
        if let screenContext,
           screenContext.utf16.count > 5_000 ||
           screenContext.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw JarvisChatClientError.invalidScreenContext
        }
    }

    private func encode<Value: Encodable>(_ value: Value) throws -> Data {
        do {
            return try JSONEncoder().encode(value)
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
    }

    private static func decode(event: ServerSentEvent, sessionId: String) throws -> ChatEvent {
        let data = Data(event.data.utf8)
        switch event.name {
        case "user":
            let message = try decodeMessage(data, expectedRole: .dan, sessionId: sessionId)
            return .user(message)
        case "delta":
            let payload = try JSONDecoder().decode(TextPayload.self, from: data)
            guard !payload.text.isEmpty else { throw JarvisChatClientError.invalidResponse }
            return .delta(text: payload.text)
        case "acknowledgment":
            let payload = try JSONDecoder().decode(TextPayload.self, from: data)
            guard !payload.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  payload.text.unicodeScalars.count <= 500 else {
                throw JarvisChatClientError.invalidResponse
            }
            return .acknowledgment(text: payload.text)
        case "food_invitation":
            let value = try JSONDecoder().decode(JSONValue.self, from: data)
            if case .null = value { return .foodInvitation(nil) }
            let invitation = try JSONDecoder().decode(ChatFoodInvitation.self, from: data)
            guard invitation.id.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
                  !invitation.summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  invitation.summary.utf16.count <= 4_000,
                  !invitation.expiresAt.isEmpty else {
                throw JarvisChatClientError.invalidResponse
            }
            return .foodInvitation(invitation)
        case "interrupted":
            return .interrupted(try decodeMessage(data, expectedRole: .jarvis, sessionId: sessionId))
        case "done":
            return .done(try decodeMessage(data, expectedRole: .jarvis, sessionId: sessionId))
        case "error":
            guard let failure = try? JSONDecoder().decode(ChatTurnFailure.self, from: data) else {
                throw JarvisChatClientError.invalidResponse
            }
            return .error(failure)
        default:
            return .unknown(name: event.name, data: event.data)
        }
    }

    private static func decodeMessage(
        _ data: Data,
        expectedRole: ConversationRole,
        sessionId: String
    ) throws -> ChatMessage {
        guard let message = try? JSONDecoder().decode(ChatMessage.self, from: data),
              validID(message.id),
              message.sessionId == sessionId,
              message.role == expectedRole else {
            throw JarvisChatClientError.invalidResponse
        }
        return message
    }

    private static func isRetryable(_ error: JarvisClientError) -> Bool {
        switch error {
        case .networkFailure, .timedOut, .serviceUnavailable, .rateLimited:
            return true
        case .httpStatus(let status):
            return (500...599).contains(status)
        default:
            return false
        }
    }

    private static func shouldReattach(after error: any Error) -> Bool {
        if error as? JarvisChatClientError == .streamEnded { return true }
        guard let error = error as? JarvisClientError else { return false }
        return isRetryable(error)
    }

    private static func mappedStreamError(_ error: any Error) -> any Error {
        if error is CancellationError { return CancellationError() }
        if let error = error as? JarvisChatClientError { return error }
        if let error = error as? JarvisClientError { return error }
        if let failure = error as? HTTPTransportFailure {
            switch failure {
            case .network:
                return JarvisClientError.networkFailure
            case .timedOut:
                return JarvisClientError.timedOut
            }
        }
        return JarvisClientError.networkFailure
    }

    private static func validID(_ value: String) -> Bool {
        value.range(of: #"^[1-9][0-9]{0,18}$"#, options: .regularExpression) != nil &&
            Int64(value) != nil
    }

    private static func validUUID(_ value: String) -> Bool {
        value.range(
            of: #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    private static func quotedFilename(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

private struct SessionRequest: Encodable {
    let channel: String
    let language: ChatLanguage
}

private struct SendTurnRequest: Encodable {
    let text: String
    let attachmentIds: [String]?
    let screenContext: String?
}

private struct ActiveTurnsResponse: Decodable {
    let turns: [ActiveChatTurn]
}

private struct CancelTurnResponse: Decodable {
    let cancelled: Bool
}

private struct TextPayload: Decodable {
    let text: String
}
