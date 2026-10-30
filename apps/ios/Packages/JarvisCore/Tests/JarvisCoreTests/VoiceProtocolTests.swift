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
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.connectionDropped)
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
}

final class VoiceSessionClientTests: XCTestCase {
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

private actor FakeWebSocketTransport: WebSocketTransport {
    private struct Connection: Sendable {
        let url: URL
        let subprotocols: [String]
    }

    private var streams: [AsyncThrowingStream<String, any Error>]
    private var remainingFailures: Int
    private var attempts = 0
    private var recordedConnections: [Connection] = []
    private var messages: [String] = []
    private var closeCodes: [UInt16] = []
    private var activeContinuation: AsyncThrowingStream<String, any Error>.Continuation?

    init(streams: [AsyncThrowingStream<String, any Error>], failuresAfterInitialConnect: Int = 0) {
        self.streams = streams
        self.remainingFailures = failuresAfterInitialConnect
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
