import Foundation
import XCTest
@testable import JarvisCore

final class VoiceProtocolTests: XCTestCase {
    func testClientMessagesEncodeToKnownJSON() throws {
        let cases: [(VoiceClientMessage, String)] = [
            (.appendAudio("AAECAw=="), #"{"audio":"AAECAw==","type":"input_audio_buffer.append"}"#),
            (.microphoneActive, #"{"type":"jarvis.microphone.active"}"#),
            (.microphoneMuted, #"{"type":"jarvis.microphone.muted"}"#),
            (.sessionEnd, #"{"type":"jarvis.session.end"}"#),
            (.cameraState(on: true), #"{"on":true,"type":"jarvis.camera.state"}"#),
            (
                .playbackCompleted(responseID: "response-fixture", audible: false),
                #"{"audible":false,"responseId":"response-fixture","type":"jarvis.voice.playback.completed"}"#
            ),
            (
                .screenContext(try VoiceScreenContext(
                    source: .camera,
                    capturedAt: "2026-10-30T00:00:00.000Z",
                    question: "What is shown?",
                    frameId: "frame_fixture",
                    itemId: "item_fixture"
                )),
                #"{"capturedAt":"2026-10-30T00:00:00.000Z","frameId":"frame_fixture","itemId":"item_fixture","question":"What is shown?","source":"camera","type":"jarvis.screen.context"}"#
            ),
            (
                .screenContextUnavailable(itemID: "item_fixture", reason: .dailyLimit),
                #"{"itemId":"item_fixture","reason":"daily_limit","type":"jarvis.screen.context.unavailable"}"#
            ),
        ]

        for (message, expected) in cases {
            XCTAssertEqual(try message.jsonString(), expected)
        }
    }

    func testServerMessagesDecodeKnownAndUnknownShapes() {
        let cases: [(String, VoiceServerMessage)] = [
            (#"{"type":"jarvis.session.ready","sessionId":41}"#, .sessionReady(sessionID: 41)),
            (#"{"type":"jarvis.session.ready","sessionId":"41"}"#, .sessionReady(sessionID: 41)),
            (#"{"type":"jarvis.session.ended"}"#, .sessionEnded),
            (
                #"{"type":"conversation.item.input_audio_transcription.completed","transcript":"Synthetic words","item_id":"item-1"}"#,
                .transcriptionCompleted(transcript: "Synthetic words", itemID: "item-1")
            ),
            (#"{"type":"input_audio_buffer.speech_started"}"#, .speechStarted),
            (#"{"type":"response.created","response":{"id":"response-1"}}"#, .responseCreated(responseID: "response-1")),
            (#"{"type":"response.audio.delta","delta":"AAECAw=="}"#, .audioDelta(type: "response.audio.delta", delta: "AAECAw==")),
            (#"{"type":"response.output_audio.delta","delta":"AQID"}"#, .audioDelta(type: "response.output_audio.delta", delta: "AQID")),
            (#"{"type":"response.done"}"#, .responseDone),
            (#"{"type":"response.cancelled"}"#, .responseCancelled),
            (#"{"type":"conversation.item.input_audio_transcription.delta","transcript":"Synthetic","item_id":"item-2"}"#, .transcriptionDelta(transcript: "Synthetic", itemID: "item-2")),
            (#"{"type":"response.audio_transcript.delta","delta":"Synthetic reply"}"#, .assistantTranscriptDelta("Synthetic reply")),
            (#"{"type":"jarvis.visual_context","itemId":"item-2","visualPath":"image"}"#, .visualContext(itemID: "item-2", path: "image", reason: nil)),
            (#"{"type":"jarvis.screen.context.unavailable","itemId":"item-2","reason":"daily_limit"}"#, .screenContextUnavailable(itemID: "item-2", reason: "daily_limit")),
        ]

        for (raw, expected) in cases {
            XCTAssertEqual(VoiceServerMessage.decode(raw), expected)
        }

        let unknown = #" { "type" : "future.voice.event", "value" : 7 } "#
        XCTAssertEqual(
            VoiceServerMessage.decode(unknown),
            .unknown(type: "future.voice.event", raw: unknown)
        )
        XCTAssertEqual(VoiceServerMessage.decode("not JSON"), .unknown(type: nil, raw: "not JSON"))
    }

    func testVoiceEndpointsFollowLanguageAndConfiguredBasePath() throws {
        XCTAssertEqual(
            try VoiceEndpoint.url(
                baseURL: URL(string: "https://api.example.invalid/backend/")!,
                language: .en
            ).absoluteString,
            "wss://api.example.invalid/backend/voice"
        )
        XCTAssertEqual(
            try VoiceEndpoint.url(
                baseURL: URL(string: "http://api.example.invalid")!,
                language: .da
            ).absoluteString,
            "ws://api.example.invalid/voice/da"
        )
        XCTAssertThrowsError(try VoiceEndpoint.url(
            baseURL: URL(string: "ftp://api.example.invalid")!,
            language: .en
        ))
    }

    func testAudioCodecUsesPCM16FormatAndRoundTripsBytes() throws {
        let bytes = Data([0x00, 0x01, 0xFE, 0xFF])

        XCTAssertEqual(VoiceAudioFormat.sampleRate, 24_000)
        XCTAssertEqual(VoiceAudioFormat.channels, 1)
        XCTAssertEqual(VoiceAudioFormat.bitsPerSample, 16)
        XCTAssertEqual(try VoiceAudioCodec.encodePCM16(bytes), "AAH+/w==")
        XCTAssertEqual(try VoiceAudioCodec.decodePCM16("AAH+/w=="), bytes)
    }

    func testAudioCodecRejectsEmptyOversizedAndMisalignedChunks() throws {
        XCTAssertThrowsError(try VoiceAudioCodec.encodePCM16(Data()))
        XCTAssertThrowsError(try VoiceAudioCodec.encodePCM16(Data([0x01])))
        XCTAssertThrowsError(try VoiceAudioCodec.encodePCM16(Data(
            repeating: 0,
            count: VoiceAudioCodec.maximumChunkBytes + 2
        )))
        XCTAssertThrowsError(try VoiceAudioCodec.decodePCM16("!"))
        XCTAssertThrowsError(try VoiceAudioCodec.decodePCM16("AQ=="))
    }

    func testScreenContextRejectsUnboundedOrUncorrelatedInput() {
        XCTAssertThrowsError(try VoiceScreenContext(
            source: .camera,
            capturedAt: "2026-10-30T00:00:00.000Z",
            question: "What is shown?",
            frameId: "bad/id",
            itemId: "item_fixture"
        ))
        XCTAssertThrowsError(try VoiceScreenContext(
            source: .camera,
            capturedAt: "2026-10-30T00:00:00.000Z",
            question: "What is shown?",
            frameId: "frame_fixture"
        ))
    }

    func testStateMachineCoversNormalSessionAndReconnect() {
        var machine = VoiceSessionStateMachine()

        machine.apply(.start)
        XCTAssertEqual(machine.state, .connecting)
        machine.apply(.connected)
        XCTAssertEqual(machine.state, .ready)
        machine.apply(.sessionReady)
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.microphoneMuted)
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.responseCreated(id: "response-1"))
        XCTAssertEqual(machine.state, .ready)
        machine.apply(.audioDelta)
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.responseFinished)
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.playbackFinished(responseID: "wrong-response"))
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.playbackFinished(responseID: "response-1"))
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.responseCreated(id: "response-2"))
        machine.apply(.audioDelta)
        machine.apply(.responseCancelled)
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.connectionDropped)
        XCTAssertEqual(machine.state, .reconnecting(attempt: 0))
        machine.apply(.microphoneActive)
        XCTAssertEqual(machine.state, .reconnecting(attempt: 0))
        machine.apply(.reconnectAttempt(1))
        machine.apply(.reconnected)
        XCTAssertEqual(machine.state, .connecting)
        machine.apply(.sessionReady)
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.endRequested)
        XCTAssertEqual(machine.state, .ended)
    }

    func testSpeechDuringPlaybackImmediatelyReturnsInterruptAction() {
        var machine = VoiceSessionStateMachine()
        machine.apply(.start)
        machine.apply(.connected)
        machine.apply(.sessionReady)
        machine.apply(.responseCreated(id: "response-2"))
        machine.apply(.audioDelta)
        machine.apply(.microphoneMuted)
        machine.apply(.microphoneActive)
        XCTAssertEqual(machine.state, .speaking)

        XCTAssertEqual(
            machine.apply(.speechStarted),
            [.interruptPlayback(responseID: "response-2")]
        )
        XCTAssertEqual(machine.state, .listening)
    }

    func testReconnectPolicyCapsAttemptsAndDelay() {
        let policy = VoiceReconnectPolicy()

        XCTAssertEqual((1...8).map(policy.delay(forAttempt:)), [
            .seconds(1), .seconds(2), .seconds(4), .seconds(8),
            .seconds(10), .seconds(10), .seconds(10), .seconds(10),
        ])
        XCTAssertEqual(policy.maximumAttempts, 8)
        XCTAssertFalse(policy.shouldReconnect(attempt: 1, userEnded: true))
        XCTAssertFalse(policy.shouldReconnect(attempt: 9, userEnded: false))
        XCTAssertTrue(policy.shouldReconnect(attempt: 8, userEnded: false))
    }

    func testFreshSessionEligibilityAndLocalizedVoiceCopy() {
        XCTAssertTrue(VoiceSessionState.idle.canStartSession)
        XCTAssertTrue(VoiceSessionState.ended.canStartSession)
        XCTAssertTrue(VoiceSessionState.failed.canStartSession)
        for state in [VoiceSessionState.connecting, .ready, .listening, .speaking, .reconnecting(attempt: 1)] {
            XCTAssertFalse(state.canStartSession)
        }
        for key in JarvisVoiceLocalizationKey.allCases {
            for language in JarvisAppLanguage.allCases {
                XCTAssertNotEqual(JarvisVoiceLocalization.string(key, language: language), "voice.\(key.rawValue)")
            }
        }
        XCTAssertEqual(JarvisVoiceLocalization.string(.listening, language: .da), "Lytter")
        XCTAssertEqual(JarvisVoiceLocalization.string(.thinking, language: .en), "Thinking")
        XCTAssertEqual(JarvisVoiceLocalization.string(.speaking, language: .da), "Taler")
        XCTAssertEqual(JarvisVoiceLocalization.string(.end, language: .da), "Afslut samtale")
    }
}

final class VoiceConnectionPresentationTests: XCTestCase {
    func testConnectionLossRetryRecoveryAndEndTransitions() {
        var machine = VoiceConnectionPresentationStateMachine()
        XCTAssertEqual(machine.state, .connected)

        XCTAssertEqual(machine.apply(.connectionDropped), .lost)
        XCTAssertEqual(machine.apply(.retryRequested), .retrying)
        XCTAssertEqual(machine.apply(.connected), .connected)
        XCTAssertEqual(machine.apply(.connectionDropped), .lost)
        XCTAssertEqual(machine.apply(.retryRequested), .retrying)
        XCTAssertEqual(machine.apply(.retryFailed), .lost)
        XCTAssertEqual(machine.apply(.ended), .ended)
    }

    func testInitialFailureDoesNotShowConnectionLost() {
        var machine = VoiceConnectionPresentationStateMachine()

        XCTAssertEqual(machine.apply(.retryFailed), .connected)
        XCTAssertEqual(machine.state, .connected)
    }

    func testConnectionLostActionsAndStatusAreLocalized() {
        XCTAssertEqual(
            JarvisNotesLocalization.string(.voiceConnectionLost, language: .da),
            "Forbindelsen blev afbrudt"
        )
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceRetryNow, language: .da), "Prøv igen nu")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceRetrying, language: .da), "Forbinder igen")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceConnectionEnd, language: .da), "Afslut")
        XCTAssertEqual(
            JarvisNotesLocalization.string(.voiceConnectionLost, language: .en),
            "Connection lost"
        )
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceRetryNow, language: .en), "Retry now")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceRetrying, language: .en), "Reconnecting")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceConnectionEnd, language: .en), "End")
    }
}

final class VoiceSessionClientTests: XCTestCase {
    func testMuteStillBlocksCaptureWhenSocketNotificationFails() async throws {
        let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
        defer { continuation.finish() }
        let transport = FakeWebSocketTransport(streams: [stream], failMutedMessages: true)
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!, transport: transport
        )
        try await client.start(accessToken: "fixture.token_1", language: .da)
        do {
            try await client.setMuted(true)
            XCTFail("The transport failure must remain visible")
        } catch {
            XCTAssertTrue(error is FakeVoiceSocketError)
        }
        try await client.sendAudio(Data([1, 2]))
        var sent = await transport.sentTexts()
        XCTAssertFalse(sent.contains { $0.contains("input_audio_buffer.append") })
        try await client.setMuted(false)
        try await client.sendAudio(Data([1, 2]))
        sent = await transport.sentTexts()
        XCTAssertEqual(sent.filter { $0.contains("input_audio_buffer.append") }.count, 1)
        try await client.end()
    }

    func testMutedMicrophoneSuppressesAudioUntilUnmuted() async throws {
        let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
        defer { continuation.finish() }
        let transport = FakeWebSocketTransport(streams: [stream])
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!, transport: transport
        )
        try await client.start(accessToken: "fixture.token_1", language: .da)
        try await client.setMuted(true)
        try await client.sendAudio(Data([1, 2]))
        try await client.setMuted(true)
        var sent = await transport.sentTexts()
        XCTAssertEqual(sent.filter { $0.contains("jarvis.microphone.muted") }.count, 1)
        XCTAssertFalse(sent.contains { $0.contains("input_audio_buffer.append") })
        try await client.setMuted(false)
        try await client.sendAudio(Data([1, 2]))
        sent = await transport.sentTexts()
        XCTAssertEqual(sent.filter { $0.contains("input_audio_buffer.append") }.count, 1)
        try await client.end()
        let state = await client.state()
        XCTAssertEqual(state, .ended)
    }

    func testFakeSocketSessionHandlesMuteInterruptEndAndReconnect() async throws {
        let first = AsyncThrowingStream<String, any Error> { continuation in
            continuation.yield(#"{"type":"jarvis.session.ready","sessionId":41}"#)
            continuation.finish(throwing: FakeVoiceSocketError.dropped)
        }
        let (second, secondContinuation) = AsyncThrowingStream<String, any Error>.makeStream()
        secondContinuation.yield(#"{"type":"jarvis.session.ready","sessionId":42}"#)
        let transport = FakeWebSocketTransport(streams: [first, second])
        let clock = FakeVoiceClock()
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: transport,
            clock: clock
        )

        try await client.start(accessToken: "fixture.token_1", language: .da)
        await waitForState(.listening, in: client)
        await waitForSentMessage(#""type":"jarvis.microphone.active""#, count: 2, on: transport)
        let listeningState = await client.state()
        XCTAssertEqual(listeningState, .listening)

        try await client.sendAudio(Data([0x01, 0x02]))
        try await client.setMuted(true)
        try await client.setMuted(false)
        try await client.setCameraState(on: false)
        try await client.sendScreenContext(VoiceScreenContext(
            source: .camera,
            capturedAt: "2026-10-30T00:00:00.000Z",
            question: "What is shown?",
            frameId: "frame_fixture",
            itemId: "item_fixture"
        ))
        try await client.playbackCompleted(responseID: "response-2", audible: false)

        secondContinuation.yield(#"{"type":"response.created","response":{"id":"response-2"}}"#)
        secondContinuation.yield(#"{"type":"response.audio.delta","delta":"AAE="}"#)
        secondContinuation.yield(#"{"type":"input_audio_buffer.speech_started"}"#)
        await waitForSentMessage(#""type":"jarvis.voice.playback.completed""#, on: transport)

        try await client.end()
        let endedState = await client.state()
        XCTAssertEqual(endedState, .ended)

        let connections = await transport.connections()
        XCTAssertEqual(connections.count, 2)
        XCTAssertEqual(connections[0].url.absoluteString, "wss://api.example.invalid/voice/da")
        XCTAssertEqual(connections[0].subprotocols, ["jarvis.voice.v1", "jarvis.auth.fixture.token_1"])
        XCTAssertEqual(connections[1].subprotocols, connections[0].subprotocols)

        let sent = await transport.sentTexts()
        XCTAssertTrue(sent.contains(#"{"type":"jarvis.microphone.active"}"#))
        XCTAssertTrue(sent.contains(#"{"audio":"AQI=","type":"input_audio_buffer.append"}"#))
        XCTAssertTrue(sent.contains(#"{"type":"jarvis.microphone.muted"}"#))
        XCTAssertTrue(sent.contains(#"{"on":false,"type":"jarvis.camera.state"}"#))
        XCTAssertTrue(sent.contains(#"{"capturedAt":"2026-10-30T00:00:00.000Z","frameId":"frame_fixture","itemId":"item_fixture","question":"What is shown?","source":"camera","type":"jarvis.screen.context"}"#))
        XCTAssertTrue(sent.contains(#"{"audible":false,"responseId":"response-2","type":"jarvis.voice.playback.completed"}"#))
        XCTAssertTrue(sent.contains(#"{"type":"jarvis.session.end"}"#))
        let closedCodes = await transport.closedCodes()
        let sleeps = await clock.sleeps()
        XCTAssertEqual(closedCodes, [1000])
        XCTAssertEqual(sleeps, [.seconds(1)])
    }

    func testEightFailedReconnectAttemptsEndInFailed() async throws {
        let dropped = AsyncThrowingStream<String, any Error> { continuation in
            continuation.yield(#"{"type":"jarvis.session.ready","sessionId":1}"#)
            continuation.finish(throwing: FakeVoiceSocketError.dropped)
        }
        let transport = FakeWebSocketTransport(streams: [dropped], failuresAfterInitialConnect: 8)
        let clock = FakeVoiceClock()
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: transport,
            clock: clock
        )

        try await client.start(accessToken: "fixture.token", language: .en)
        await waitForState(.failed, in: client)

        let finalState = await client.state()
        let attempts = await transport.connectionAttempts()
        let sleeps = await clock.sleeps()
        let closedCodes = await transport.closedCodes()
        XCTAssertEqual(finalState, .failed)
        XCTAssertEqual(attempts, 9)
        XCTAssertEqual(sleeps, [
            .seconds(1), .seconds(2), .seconds(4), .seconds(8),
            .seconds(10), .seconds(10), .seconds(10), .seconds(10),
        ])
        XCTAssertEqual(closedCodes, [1011])
    }

    func testUserEndedSessionDoesNotReconnect() async throws {
        let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
        let transport = FakeWebSocketTransport(streams: [stream])
        let clock = FakeVoiceClock()
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: transport,
            clock: clock
        )

        try await client.start(accessToken: "fixture.token", language: .en)
        continuation.yield(#"{"type":"jarvis.session.ready","sessionId":12}"#)
        await waitForState(.listening, in: client)
        try await client.end()
        continuation.finish(throwing: FakeVoiceSocketError.dropped)
        await Task.yield()

        let finalState = await client.state()
        let attempts = await transport.connectionAttempts()
        let sleeps = await clock.sleeps()
        XCTAssertEqual(finalState, .ended)
        XCTAssertEqual(attempts, 1)
        XCTAssertTrue(sleeps.isEmpty)
    }

    func testSpeakingStateContinuesUntilPlaybackCompletion() async throws {
        let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
        let stateRecorder = VoiceStateRecorder()
        let client = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: FakeWebSocketTransport(streams: [stream]),
            onStateChange: { state in
                Task { await stateRecorder.record(state) }
            }
        )

        try await client.start(accessToken: "fixture.token", language: .en)
        continuation.yield(#"{"type":"jarvis.session.ready","sessionId":12}"#)
        await waitForState(.listening, in: client)
        continuation.yield(#"{"type":"response.created","response":{"id":"response-3"}}"#)
        continuation.yield(#"{"type":"response.audio.delta","delta":"AAE="}"#)
        continuation.yield(#"{"type":"response.done"}"#)
        for _ in 0..<1_000 {
            if await stateRecorder.count(of: .speaking) >= 2 { break }
            await Task.yield()
        }
        let speakingUpdates = await stateRecorder.count(of: .speaking)
        XCTAssertEqual(speakingUpdates, 2)
        let stateBeforePlaybackCompletion = await client.state()
        XCTAssertEqual(stateBeforePlaybackCompletion, .speaking)

        try await client.playbackCompleted(responseID: "response-3", audible: true)
        await waitForState(.listening, in: client)
        continuation.finish()
        try await client.end()
    }

    func testEndThenOpenFreshSessionConnectsWithoutRefresh() async throws {
        let (oldStream, oldContinuation) = AsyncThrowingStream<String, any Error>.makeStream()
        let oldTransport = FakeWebSocketTransport(streams: [oldStream])
        let oldClient = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: oldTransport
        )
        try await oldClient.start(accessToken: "fixture.old", language: .en)
        oldContinuation.yield(#"{"type":"jarvis.session.ready","sessionId":12}"#)
        await waitForState(.listening, in: oldClient)
        try await oldClient.setMuted(true)
        try await oldClient.setCameraState(on: true)
        try await oldClient.end()

        let endedState = await oldClient.state()
        XCTAssertTrue(endedState.canStartSession, "Reopening Voice must auto-start after End")
        let (newStream, newContinuation) = AsyncThrowingStream<String, any Error>.makeStream()
        let newTransport = FakeWebSocketTransport(streams: [newStream])
        let newClient = VoiceSessionClient(
            baseURL: URL(string: "https://api.example.invalid")!,
            transport: newTransport
        )
        if endedState.canStartSession {
            try await newClient.start(accessToken: "fixture.new", language: .da)
        }
        oldContinuation.yield(#"{"type":"jarvis.session.ended"}"#)
        oldContinuation.finish(throwing: FakeVoiceSocketError.dropped)
        newContinuation.yield(#"{"type":"jarvis.session.ready","sessionId":13}"#)
        await waitForState(.listening, in: newClient)
        await waitForSentMessage(#""type":"jarvis.microphone.active""#, count: 1, on: newTransport)
        let connections = await newTransport.connections()
        XCTAssertEqual(connections.count, 1)
        XCTAssertEqual(connections.first?.url.absoluteString, "wss://api.example.invalid/voice/da")
        XCTAssertEqual(connections.first?.subprotocols, ["jarvis.voice.v1", "jarvis.auth.fixture.new"])
        let texts = await newTransport.sentTexts()
        XCTAssertFalse(texts.contains(#"{"type":"jarvis.microphone.muted"}"#))
        XCTAssertFalse(texts.contains(#"{"on":true,"type":"jarvis.camera.state"}"#))
        let closes = await oldTransport.closedCodes()
        XCTAssertEqual(closes, [1000])
        let oldAttempts = await oldTransport.connectionAttempts()
        XCTAssertEqual(oldAttempts, 1)
        try await newClient.end()
        newContinuation.finish()
    }

    private func waitForState(
        _ expected: VoiceSessionState,
        in client: VoiceSessionClient,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<1_000 {
            if await client.state() == expected { return }
            await Task.yield()
        }
        XCTFail("Session did not reach \(expected)", file: file, line: line)
    }

    private func waitForSentMessage(
        _ fragment: String,
        count: Int = 1,
        on transport: FakeWebSocketTransport,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        for _ in 0..<1_000 {
            if await transport.sentTexts().filter({ $0.contains(fragment) }).count >= count { return }
            await Task.yield()
        }
        XCTFail("Socket did not send \(count) messages containing \(fragment)", file: file, line: line)
    }
}

private actor VoiceStateRecorder {
    private var states: [VoiceSessionState] = []

    func record(_ state: VoiceSessionState) {
        states.append(state)
    }

    func count(of expected: VoiceSessionState) -> Int {
        states.filter { $0 == expected }.count
    }
}

private actor FakeWebSocketTransport: WebSocketTransport {
    private struct Connection: Sendable {
        let url: URL
        let subprotocols: [String]
    }

    private var streams: [AsyncThrowingStream<String, any Error>]
    private var remainingFailures: Int
    private let failMutedMessages: Bool
    private var attempts = 0
    private var recordedConnections: [Connection] = []
    private var messages: [String] = []
    private var closeCodes: [UInt16] = []
    private var activeContinuation: AsyncThrowingStream<String, any Error>.Continuation?

    init(
        streams: [AsyncThrowingStream<String, any Error>],
        failuresAfterInitialConnect: Int = 0,
        failMutedMessages: Bool = false
    ) {
        self.streams = streams
        self.remainingFailures = failuresAfterInitialConnect
        self.failMutedMessages = failMutedMessages
    }

    func connect(url: URL, subprotocols: [String]) async throws {
        attempts += 1
        if attempts > 1, remainingFailures > 0 {
            remainingFailures -= 1
            throw FakeVoiceSocketError.connectFailed
        }
        recordedConnections.append(Connection(url: url, subprotocols: subprotocols))
    }

    func send(text: String) async throws {
        if failMutedMessages, text.contains("jarvis.microphone.muted") {
            throw FakeVoiceSocketError.dropped
        }
        messages.append(text)
    }

    func receive() async -> AsyncThrowingStream<String, any Error> {
        guard !streams.isEmpty else {
            return AsyncThrowingStream { $0.finish() }
        }
        let stream = streams.removeFirst()
        activeContinuation = nil
        return stream
    }

    func close(code: UInt16) async {
        closeCodes.append(code)
        activeContinuation?.finish()
    }

    func connections() -> [(url: URL, subprotocols: [String])] {
        recordedConnections.map { ($0.url, $0.subprotocols) }
    }

    func sentTexts() -> [String] {
        messages
    }

    func closedCodes() -> [UInt16] {
        closeCodes
    }

    func connectionAttempts() -> Int {
        attempts
    }
}

private actor FakeVoiceClock: ChatClock {
    private var recordedSleeps: [Duration] = []

    func now() async -> Duration {
        .zero
    }

    func sleep(for duration: Duration) async throws {
        recordedSleeps.append(duration)
    }

    func sleeps() -> [Duration] {
        recordedSleeps
    }
}

private enum FakeVoiceSocketError: Error {
    case dropped
    case connectFailed
}
