import Foundation

public enum VoiceSessionState: Equatable, Sendable {
    case idle
    case connecting
    case ready
    case listening
    case speaking
    case reconnecting(attempt: Int)
    case ended
    case failed

    public var canStartSession: Bool {
        self == .idle || self == .ended || self == .failed
    }

}

private enum EndAcknowledgementResult: Sendable {
    case acknowledged
    case failed
    case timedOut
}

public enum VoiceConnectionPresentationState: Equatable, Sendable {
    case connected
    case lost
    case retrying
    case ended
}

public enum VoiceConnectionPresentationEvent: Equatable, Sendable {
    case connected
    case connectionDropped
    case retryRequested
    case retryFailed
    case ended
}

public struct VoiceConnectionPresentationStateMachine: Sendable {
    public private(set) var state: VoiceConnectionPresentationState = .connected

    public init() {}

    @discardableResult
    public mutating func apply(_ event: VoiceConnectionPresentationEvent) -> VoiceConnectionPresentationState {
        switch event {
        case .connected:
            state = .connected
        case .connectionDropped where state == .connected || state == .retrying:
            state = .lost
        case .retryRequested where state == .lost:
            state = .retrying
        case .retryFailed where state == .retrying:
            state = .lost
        case .ended:
            state = .ended
        default:
            break
        }
        return state
    }
}

public enum VoiceSessionEvent: Equatable, Sendable {
    case start
    case connected
    case sessionReady
    case microphoneActive
    case microphoneMuted
    case responseCreated(id: String?)
    case audioDelta
    case responseFinished
    case responseCancelled
    case playbackFinished(responseID: String)
    case connectionDropped
    case reconnectAttempt(Int)
    case reconnected
    case reconnectExhausted
    case sessionEnded
    case endRequested
    case failed
}

public struct VoiceSessionStateMachine: Sendable {
    public private(set) var state: VoiceSessionState = .idle
    private var responseID: String?
    private var responseHasAudio = false

    public init() {}

    public mutating func apply(_ event: VoiceSessionEvent) {
        switch event {
        case .start where state == .idle:
            state = .connecting
        case .connected where state == .connecting:
            state = .ready
        case .sessionReady where state == .connecting || state == .ready ||
            isReconnecting:
            state = .listening
        case .microphoneActive, .microphoneMuted:
            break
        case .responseCreated(let id) where isLive:
            responseID = id
            responseHasAudio = false
            state = .ready
        case .audioDelta where isLive:
            responseHasAudio = true
            state = .speaking
        case .responseFinished where isLive:
            if !responseHasAudio || responseID == nil {
                state = .listening
                responseID = nil
                responseHasAudio = false
            }
        case .responseCancelled where isLive:
            state = .listening
            responseID = nil
            responseHasAudio = false
        case .playbackFinished(let id) where isLive && state == .speaking && responseID == id:
            state = .listening
            responseID = nil
            responseHasAudio = false
        case .connectionDropped where isLive:
            state = .reconnecting(attempt: 0)
            responseID = nil
            responseHasAudio = false
        case .reconnectAttempt(let attempt) where isReconnecting:
            state = .reconnecting(attempt: attempt)
        case .reconnected where isReconnecting:
            state = .connecting
        case .reconnectExhausted where isReconnecting:
            state = .failed
        case .endRequested:
            break
        case .sessionEnded:
            state = .ended
            responseID = nil
            responseHasAudio = false
        case .failed:
            state = .failed
            responseID = nil
            responseHasAudio = false
        default:
            break
        }
    }

    private var isReconnecting: Bool {
        if case .reconnecting = state { return true }
        return false
    }

    private var isLive: Bool {
        switch state {
        case .connecting, .ready, .listening, .speaking, .reconnecting:
            return true
        case .idle, .ended, .failed:
            return false
        }
    }
}

public struct VoiceReconnectPolicy: Sendable {
    public let maximumAttempts: Int
    public let initialDelay: Duration
    public let maximumDelay: Duration

    public init(
        maximumAttempts: Int = 8,
        initialDelay: Duration = .seconds(1),
        maximumDelay: Duration = .seconds(10)
    ) {
        self.maximumAttempts = min(max(maximumAttempts, 0), 8)
        self.initialDelay = min(max(initialDelay, .zero), .seconds(10))
        self.maximumDelay = min(max(maximumDelay, .zero), .seconds(10))
    }

    public func delay(forAttempt attempt: Int) -> Duration {
        guard attempt > 0 else { return .zero }
        let boundedAttempt = min(attempt, 8)
        var delay = min(initialDelay, maximumDelay)
        for _ in 1..<boundedAttempt where delay < maximumDelay {
            delay = min(delay + delay, maximumDelay)
        }
        return delay
    }

    public func shouldReconnect(attempt: Int, userEnded: Bool) -> Bool {
        !userEnded && attempt > 0 && attempt <= maximumAttempts
    }
}

public protocol WebSocketTransport: Sendable {
    func connect(url: URL, subprotocols: [String]) async throws
    func send(text: String) async throws
    func receive() async -> AsyncThrowingStream<String, any Error>
    func close(code: UInt16) async
}

public actor VoiceSessionClient {
    private let baseURL: URL
    private let transport: any WebSocketTransport
    private let clock: any ChatClock
    private let reconnectPolicy: VoiceReconnectPolicy
    private let onMessage: @Sendable (VoiceServerMessage) -> Void
    private let onStateChange: @Sendable (VoiceSessionState) -> Void
    private var machine = VoiceSessionStateMachine()
    private var endpoint: URL?
    private var subprotocols: [String] = []
    private var receiveTask: Task<Void, Never>?
    private var reconnectAttempts = 0
    private var isConnected = false
    private var isMuted = false
    private var cameraState: Bool?
    private var userEnded = false
    private var endWaiter: CheckedContinuation<EndAcknowledgementResult, Never>?
    private var pendingEndResult: EndAcknowledgementResult?
    private let endAcknowledgementTimeout: Duration

    public init(
        baseURL: URL,
        transport: any WebSocketTransport,
        clock: any ChatClock = ContinuousChatClock(),
        reconnectPolicy: VoiceReconnectPolicy = VoiceReconnectPolicy(),
        endAcknowledgementTimeout: Duration = .seconds(6),
        onMessage: @escaping @Sendable (VoiceServerMessage) -> Void = { _ in },
        onStateChange: @escaping @Sendable (VoiceSessionState) -> Void = { _ in }
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.clock = clock
        self.reconnectPolicy = reconnectPolicy
        self.endAcknowledgementTimeout = endAcknowledgementTimeout
        self.onMessage = onMessage
        self.onStateChange = onStateChange
    }

    public func state() -> VoiceSessionState {
        machine.state
    }

    public func start(accessToken: String) async throws {
        guard machine.state == .idle else { throw VoiceProtocolError.invalidState }
        guard Self.isValidSubprotocolToken(accessToken) else { throw VoiceProtocolError.invalidToken }
        let target = try VoiceEndpoint.url(baseURL: baseURL)
        endpoint = target
        subprotocols = [VoiceEndpoint.subprotocol, "jarvis.auth.\(accessToken)"]
        apply(.start)
        do {
            try await transport.connect(url: target, subprotocols: subprotocols)
            isConnected = true
            guard !userEnded, machine.state == .connecting else {
                isConnected = false
                await transport.close(code: 1000)
                clearCredentials()
                return
            }
            apply(.connected)
            receiveTask = Task { await self.receiveMessages() }
        } catch {
            if !userEnded { apply(.failed) }
            await transport.close(code: 1011)
            clearCredentials()
            throw error
        }
    }

    public func sendAudio(_ pcm16: Data) async throws {
        guard !isMuted else { return }
        try await send(.appendAudio(VoiceAudioCodec.encodePCM16(pcm16)))
    }

    public func setMuted(_ muted: Bool) async throws {
        guard isLive else { throw VoiceProtocolError.invalidState }
        guard muted != isMuted else { return }
        isMuted = muted
        apply(muted ? .microphoneMuted : .microphoneActive)
        if isConnected {
            try await send(muted ? .microphoneMuted : .microphoneActive)
        }
    }

    public func setCameraState(on: Bool) async throws {
        guard isLive else { throw VoiceProtocolError.invalidState }
        guard cameraState != on else { return }
        cameraState = on
        if isConnected {
            try await send(.cameraState(on: on))
        }
    }

    public func sendScreenContext(_ context: VoiceScreenContext) async throws {
        try await send(.screenContext(context))
    }

    public func sendScreenContextUnavailable(
        itemID: String? = nil,
        reason: VoiceScreenUnavailableReason? = nil
    ) async throws {
        try await send(.screenContextUnavailable(itemID: itemID, reason: reason))
    }

    public func playbackCompleted(responseID: String, audible: Bool) async throws {
        apply(.playbackFinished(responseID: responseID))
        try await send(.playbackCompleted(responseID: responseID, audible: audible))
    }

    public func end() async throws {
        guard !userEnded else { return }
        userEnded = true
        pendingEndResult = nil
        apply(.endRequested)
        var sendError: (any Error)?
        var sentSessionEnd = false
        if isConnected {
            do {
                try await send(.sessionEnd)
                sentSessionEnd = true
            } catch {
                sendError = error
            }
        }
        let cannotAcknowledge = switch machine.state {
        case .failed, .reconnecting:
            true
        default:
            false
        }
        let acknowledgement: EndAcknowledgementResult
        if sentSessionEnd {
            acknowledgement = await waitForEndAcknowledgement()
        } else if cannotAcknowledge {
            acknowledgement = .failed
        } else {
            acknowledgement = .acknowledged
        }
        receiveTask?.cancel()
        receiveTask = nil
        if !sentSessionEnd {
            apply(sendError == nil ? .sessionEnded : .failed)
        }
        isConnected = false
        await transport.close(code: 1000)
        clearCredentials()
        endpoint = nil
        isMuted = false
        cameraState = nil
        reconnectAttempts = 0
        if let sendError { throw sendError }
        switch acknowledgement {
        case .acknowledged:
            break
        case .failed:
            apply(.failed)
            throw VoiceProtocolError.endFailed
        case .timedOut:
            apply(.failed)
            throw VoiceProtocolError.endTimedOut
        }
    }

    private func receiveMessages() async {
        while !Task.isCancelled && isLive {
            let stream = await transport.receive()
            do {
                for try await raw in stream {
                    guard !Task.isCancelled else { return }
                    try await receive(raw)
                    guard isLive else { return }
                }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
            }
            guard !Task.isCancelled, isLive else { return }
            await reconnect()
        }
    }

    private func receive(_ raw: String) async throws {
        let message = VoiceServerMessage.decode(raw)
        onMessage(message)
        switch message {
        case .sessionReady:
            reconnectAttempts = 0
            apply(.sessionReady)
            try await send(isMuted ? .microphoneMuted : .microphoneActive)
            apply(isMuted ? .microphoneMuted : .microphoneActive)
            if let cameraState {
                try await send(.cameraState(on: cameraState))
            }
        case .sessionEnded:
            apply(.sessionEnded)
            isConnected = false
            finishEndWait(.acknowledged)
            await transport.close(code: 1000)
            clearCredentials()
        case .sessionFailed(let retryable, _):
            if userEnded {
                apply(.failed)
                isConnected = false
                finishEndWait(.failed)
                clearCredentials()
            } else if retryable {
                isConnected = false
                apply(.connectionDropped)
            } else {
                apply(.failed)
                isConnected = false
                clearCredentials()
            }
        case .responseCreated(let responseID):
            apply(.responseCreated(id: responseID))
        case .audioDelta:
            apply(.audioDelta)
        case .responseDone:
            apply(.responseFinished)
        case .responseCancelled:
            apply(.responseCancelled)
        case .transcriptionCompleted, .transcriptionDelta, .assistantTranscriptDelta,
            .visualContext, .screenContextUnavailable, .unknown:
            break
        }
    }

    private func waitForEndAcknowledgement() async -> EndAcknowledgementResult {
        if let pendingEndResult {
            self.pendingEndResult = nil
            return pendingEndResult
        }
        return await withCheckedContinuation { continuation in
            endWaiter = continuation
            let timeout = endAcknowledgementTimeout
            Task { [weak self, clock] in
                try? await clock.sleep(for: timeout)
                await self?.timeoutEndWait()
            }
        }
    }

    private func finishEndWait(_ result: EndAcknowledgementResult) {
        if let endWaiter {
            self.endWaiter = nil
            endWaiter.resume(returning: result)
        } else {
            pendingEndResult = result
        }
    }

    private func timeoutEndWait() {
        guard endWaiter != nil else { return }
        finishEndWait(.timedOut)
    }

    private func reconnect() async {
        guard !userEnded, isLive,
              let endpoint,
              reconnectPolicy.maximumAttempts > 0 else {
            if isLive {
                apply(.failed)
                      if userEnded { finishEndWait(.failed) }
                clearCredentials()
            }
            return
        }

        isConnected = false
        apply(.connectionDropped)
        let firstAttempt = reconnectAttempts + 1
        guard firstAttempt <= reconnectPolicy.maximumAttempts else {
            apply(.reconnectExhausted)
            await transport.close(code: 1011)
            clearCredentials()
            return
        }
        for attempt in firstAttempt...reconnectPolicy.maximumAttempts {
            guard reconnectPolicy.shouldReconnect(attempt: attempt, userEnded: userEnded),
                  !Task.isCancelled else { return }
            apply(.reconnectAttempt(attempt))
            do {
                try await clock.sleep(for: reconnectPolicy.delay(forAttempt: attempt))
            } catch is CancellationError {
                return
            } catch {
                continue
            }
            guard !Task.isCancelled, !userEnded else { return }
            do {
                try await transport.connect(url: endpoint, subprotocols: subprotocols)
                guard !userEnded, isLive else {
                    await transport.close(code: 1000)
                    return
                }
                reconnectAttempts = attempt
                isConnected = true
                apply(.reconnected)
                return
            } catch {
                reconnectAttempts = attempt
            }
        }
        guard !userEnded, isLive else { return }
        apply(.reconnectExhausted)
        await transport.close(code: 1011)
        clearCredentials()
    }

    private func send(_ message: VoiceClientMessage) async throws {
        guard isConnected else { throw VoiceProtocolError.invalidState }
        try await transport.send(text: message.jsonString())
    }

    private func clearCredentials() {
        subprotocols.removeAll(keepingCapacity: false)
    }

    private func apply(_ event: VoiceSessionEvent) {
        machine.apply(event)
        onStateChange(machine.state)
    }

    private var isLive: Bool {
        switch machine.state {
        case .connecting, .ready, .listening, .speaking, .reconnecting:
            return true
        case .idle, .ended, .failed:
            return false
        }
    }

    private static func isValidSubprotocolToken(_ token: String) -> Bool {
        token.range(
            of: #"^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,2048}$"#,
            options: .regularExpression
        ) != nil
    }
}
