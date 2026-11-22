import Foundation
import XCTest
@testable import JarvisCore

final class PiRuntimeTests: XCTestCase {
    func testDeviceLocationPatchKeepsPermissionAndObservationFreshness() throws {
        let observed = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-19T05:00:00Z"))
        let patch = try XCTUnwrap(DeviceLocationSettings.patch(
            city: " Copenhagen ",
            latitude: 55.6761,
            longitude: 12.5683,
            observedAt: observed
        ))
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any]
        )
        let location = try XCTUnwrap((object["settings"] as? [String: Any])?["location"] as? [String: Any])
        XCTAssertEqual(location["city"] as? String, "Copenhagen")
        XCTAssertEqual(location["permission"] as? String, "granted")
        XCTAssertEqual(location["observedAt"] as? String, "2026-11-19T05:00:00Z")
        XCTAssertEqual(location["latitude"] as? Double, 55.68)
        XCTAssertEqual(location["longitude"] as? Double, 12.57)
        XCTAssertNil(DeviceLocationSettings.permissionPatch("authorized_when_in_use"))
    }

    func testProactiveEditorPatchesTheCombinedBackgroundTurnAllowance() throws {
        let config = JarvisProactiveConfig(monthlyBudgetDkk: 100, backgroundTurnsPerDay: 12)
        var editor = JarvisProactiveSettingsEditor(settings: config)
        editor.draft.backgroundTurnsPerDay = 4
        let patch = try XCTUnwrap(editor.beginSave())
        XCTAssertEqual(patch.backgroundTurnsPerDay, 4)
        XCTAssertNil(patch.monthlyBudgetDkk)
        XCTAssertFalse(patch.isEmpty)
    }

    func testVoiceEndpointAlwaysUsesTheSinglePiRoute() throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        XCTAssertEqual(try VoiceEndpoint.url(baseURL: base).absoluteString, "wss://example.invalid/api/voice")
    }

    func testVoiceSessionConnectsOnlyToThePiRoute() async throws {
        let base = try XCTUnwrap(URL(string: "https://example.invalid/api"))
        let socket = VoiceRecordingSocket()
        try await VoiceSessionClient(baseURL: base, transport: socket).start(accessToken: "a.b.c")
        let urls = await socket.connectedURLs()
        XCTAssertEqual(urls.map(\.absoluteString), ["wss://example.invalid/api/voice"])
    }

    func testVoiceTerminalStateTableNeverResurrectsAFailedSession() {
        struct Row {
            let events: [VoiceSessionEvent]
            let expected: VoiceSessionState
        }
        let rows = [
            Row(
                events: [.start, .connected, .sessionReady, .endRequested, .sessionEnded],
                expected: .ended
            ),
            Row(
                events: [.start, .connected, .sessionReady, .endRequested, .failed, .sessionEnded],
                expected: .failed
            ),
            Row(
                events: [.endRequested, .sessionEnded],
                expected: .idle
            ),
            Row(
                events: [.start, .connected, .sessionReady, .sessionEnded, .failed],
                expected: .ended
            ),
            Row(
                events: [.start, .connectionDropped, .reconnectAttempt(1), .endRequested, .failed],
                expected: .failed
            ),
        ]

        for row in rows {
            var machine = VoiceSessionStateMachine()
            for event in row.events { machine.apply(event) }
            XCTAssertEqual(machine.state, row.expected)
        }
    }

    func testVoiceStateFollowsAuthoritativeActivityAndPlaybackIds() {
        var machine = VoiceSessionStateMachine()
        machine.apply(.start)
        XCTAssertEqual(machine.state, .connecting)
        machine.apply(.connected)
        XCTAssertEqual(machine.state, .connecting)
        machine.apply(.sessionReady)
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.activity(.thinking))
        XCTAssertEqual(machine.state, .thinking)
        machine.apply(.responseCreated(id: "response-1"))
        XCTAssertEqual(machine.state, .thinking)
        machine.apply(.audioDelta(responseID: "response-1"))
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.responseFinished(responseID: "response-1"))
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.activity(.listening))
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.playbackFinished(responseID: "response-1"))
        XCTAssertEqual(machine.state, .listening)
    }

    func testVoiceReconnectStaysVisibleUntilAProviderReadyEvent() {
        var machine = VoiceSessionStateMachine()
        for event in [VoiceSessionEvent.start, .connected, .sessionReady, .connectionDropped] {
            machine.apply(event)
        }
        XCTAssertEqual(machine.state, .reconnecting(attempt: 0))
        machine.apply(.reconnectAttempt(3))
        XCTAssertEqual(machine.state, .reconnecting(attempt: 3))
        machine.apply(.reconnected)
        XCTAssertEqual(machine.state, .reconnecting(attempt: 3))
        machine.apply(.playbackFinished(responseID: "late-response"))
        XCTAssertEqual(machine.state, .reconnecting(attempt: 3))
        machine.apply(.sessionReady)
        XCTAssertEqual(machine.state, .listening)
    }

    func testVoiceStaleCompletionCannotEndANewerSpeakingResponse() {
        var machine = VoiceSessionStateMachine()
        machine.apply(.start)
        machine.apply(.connected)
        machine.apply(.sessionReady)
        machine.apply(.responseCreated(id: "old"))
        machine.apply(.audioDelta(responseID: "old"))
        machine.apply(.responseCreated(id: "new"))
        machine.apply(.audioDelta(responseID: "new"))
        machine.apply(.responseFinished(responseID: "old"))
        machine.apply(.playbackFinished(responseID: "old"))
        XCTAssertEqual(machine.state, .speaking)
        machine.apply(.responseFinished(responseID: "new"))
        machine.apply(.playbackFinished(responseID: "new"))
        XCTAssertEqual(machine.state, .listening)
    }

    func testVoiceOlderPlaybackCannotHideANewerPendingResponse() {
        var machine = VoiceSessionStateMachine()
        machine.apply(.start)
        machine.apply(.connected)
        machine.apply(.sessionReady)
        machine.apply(.responseCreated(id: "old"))
        machine.apply(.audioDelta(responseID: "old"))
        machine.apply(.responseCreated(id: "new"))
        machine.apply(.responseFinished(responseID: "old"))
        machine.apply(.playbackFinished(responseID: "old"))
        XCTAssertEqual(machine.state, .thinking)
        machine.apply(.responseFinished(responseID: "new"))
        XCTAssertEqual(machine.state, .listening)
    }

    func testVoiceWaitsForWorkAfterAnAcknowledgementAndReturnsToListeningAfterTheAnswer() {
        var machine = VoiceSessionStateMachine()
        machine.apply(.start)
        machine.apply(.sessionReady)
        let replay: [(VoiceSessionEvent, VoiceSessionState)] = [
            (.activity(.listening), .listening),
            (.activity(.thinking), .thinking),
            (.responseCreated(id: "ack"), .thinking),
            (.audioDelta(responseID: "ack"), .speaking),
            (.activity(.speaking), .speaking),
            (.activity(.thinking), .speaking),
            (.responseFinished(responseID: "ack"), .speaking),
            (.playbackFinished(responseID: "ack"), .thinking),
            (.playbackFinished(responseID: "ack"), .thinking),
            (.responseCreated(id: "answer"), .thinking),
            (.audioDelta(responseID: "answer"), .speaking),
            (.activity(.speaking), .speaking),
            (.activity(.listening), .speaking),
            (.responseFinished(responseID: "answer"), .speaking),
            (.playbackFinished(responseID: "answer"), .listening),
        ]
        for (event, expected) in replay {
            machine.apply(event)
            XCTAssertEqual(machine.state, expected, "\(event)")
        }
    }

    func testCancelledAudioAndRelaySpeakingCannotBringBackAnOldResponse() {
        var machine = VoiceSessionStateMachine()
        for event in [VoiceSessionEvent.start, .sessionReady, .responseCreated(id: "old"),
                      .audioDelta(responseID: "old"), .responseCancelled(responseID: "old"),
                      .audioDelta(responseID: "old"), .activity(.speaking)] {
            machine.apply(event)
        }
        XCTAssertEqual(machine.state, .listening)
        machine.apply(.activity(.thinking))
        machine.apply(.responseFinished(responseID: "old"))
        machine.apply(.playbackFinished(responseID: "old"))
        XCTAssertEqual(machine.state, .thinking)
    }

    func testWatchAudioWaitsForTheRelayToOpenTheMicrophone() async throws {
        let socket = VoiceEndSocket()
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket
        )
        let audio = Data([1, 0])
        try await client.start(accessToken: "a.b.c")
        try await client.sendAudio(audio)
        let connectingFrames = await socket.sentTexts()
        XCTAssertTrue(connectingFrames.isEmpty)

        await socket.emit(#"{"type":"jarvis.session.ready","sessionId":"42"}"#)
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while await client.state() == .connecting, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(1))
        }
        try await client.sendAudio(audio)
        let frames = await socket.sentTexts()
        XCTAssertEqual(frames, [
            try VoiceClientMessage.microphoneActive.jsonString(),
            try VoiceClientMessage.appendAudio(VoiceAudioCodec.encodePCM16(audio)).jsonString()
        ])
        await socket.emit(#"{"type":"jarvis.session.ended"}"#)
    }

    func testVoiceEndWaitsForTheServerTerminalBeforeClosing() async throws {
        let socket = VoiceEndSocket()
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket,
            endAcknowledgementTimeout: .seconds(2)
        )
        try await client.start(accessToken: "a.b.c")
        await socket.emit(#"{"type":"jarvis.session.ready","sessionId":"42"}"#)
        let ending = Task { try await client.end() }
        let sentEnd = await socket.waitForText(
            #"{"type":"jarvis.session.end"}"#,
            timeout: .seconds(1)
        )
        XCTAssertTrue(sentEnd)
        let closedBeforeAcknowledgement = await socket.wasClosed()
        let stateBeforeAcknowledgement = await client.state()
        XCTAssertFalse(closedBeforeAcknowledgement)
        XCTAssertNotEqual(stateBeforeAcknowledgement, .ended)

        await socket.emit(#"{"type":"jarvis.session.ended"}"#)
        try await ending.value
        let endedState = await client.state()
        let closedAfterAcknowledgement = await socket.wasClosed()
        XCTAssertEqual(endedState, .ended)
        XCTAssertTrue(closedAfterAcknowledgement)
        let closeCodes = await socket.closeCodes()
        XCTAssertTrue(closeCodes.allSatisfy { $0 == 1000 })
    }

    func testVoiceEndTimesOutInsteadOfClaimingAnUnacknowledgedEnd() async throws {
        let socket = VoiceEndSocket()
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket,
            endAcknowledgementTimeout: .milliseconds(20)
        )
        try await client.start(accessToken: "a.b.c")
        do {
            try await client.end()
            XCTFail("Expected the missing terminal acknowledgement to time out")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endTimedOut)
        }
        let closed = await socket.wasClosed()
        XCTAssertTrue(closed)
        let state = await client.state()
        let closeCodes = await socket.closeCodes()
        XCTAssertEqual(state, .failed)
        XCTAssertEqual(closeCodes, [1011])
    }

    func testVoiceEndBeforeConnectionCannotClaimSuccess() async throws {
        let socket = VoiceEndSocket()
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket
        )
        do {
            try await client.end()
            XCTFail("Expected a pre-connect End to fail")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endFailed)
        }
        do {
            try await client.end()
            XCTFail("Expected a repeated pre-connect End to retain its failure")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endFailed)
        }
        let state = await client.state()
        let closeCodes = await socket.closeCodes()
        XCTAssertEqual(state, .failed)
        XCTAssertEqual(closeCodes, [1011])
    }

    func testVoiceEndSendFailureCannotClaimSuccessOrCloseCleanly() async throws {
        let socket = VoiceEndSocket(failSessionEnd: true)
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket
        )
        try await client.start(accessToken: "a.b.c")
        do {
            try await client.end()
            XCTFail("Expected the End send to fail")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endFailed)
        }
        let state = await client.state()
        let closeCodes = await socket.closeCodes()
        XCTAssertEqual(state, .failed)
        XCTAssertEqual(closeCodes, [1011])
    }

    func testVoiceEndDuringConnectionFailsTheStartAndCannotCloseCleanly() async throws {
        let socket = VoiceConnectingSocket()
        let client = VoiceSessionClient(
            baseURL: try XCTUnwrap(URL(string: "https://example.invalid/api")),
            transport: socket
        )
        let starting = Task { try await client.start(accessToken: "a.b.c") }
        await socket.waitUntilConnecting()

        do {
            try await client.end()
            XCTFail("Expected End during connection to fail")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endFailed)
        }
        await socket.releaseConnection()
        do {
            try await starting.value
            XCTFail("Expected the interrupted Start to fail")
        } catch {
            XCTAssertEqual(error as? VoiceProtocolError, .endFailed)
        }
        let state = await client.state()
        let closeCodes = await socket.closeCodes()
        XCTAssertEqual(state, .failed)
        XCTAssertEqual(closeCodes, [1011, 1011])
    }

    func testWarmThrottleAllowsOneAttemptPerInterval() {
        var throttle = PiWarmThrottle(interval: 300)
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(throttle.shouldWarm(now: start))
        XCTAssertFalse(throttle.shouldWarm(now: start.addingTimeInterval(299)))
        XCTAssertTrue(throttle.shouldWarm(now: start.addingTimeInterval(300)))
    }

    func testTurnBodyNeverCarriesAnEngineSelector() async throws {
        let transport = RecordingTransport([])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        _ = try await chat.sendTurn(sessionId: "12", text: "Hello")

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
        let bodies = try requests.map {
            try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap($0.body)) as? [String: Any])
        }
        XCTAssertEqual(requests.map(\.url.path), ["/api/conversation/sessions/12/turns"])
        XCTAssertNil(bodies[0]["engine"])
        XCTAssertEqual(bodies[0]["text"] as? String, "Hello")
    }

    func testPiWarmPostsEmptyObjectAndSurfacesServerFailure() async throws {
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 200, body: Data(#"{"state":"warm","alreadyWarm":false,"ms":1800}"#.utf8)),
            HTTPResponse(statusCode: 503, body: Data(#"{"error":"PI is not configured.","code":"pi_not_configured"}"#.utf8)),
        ])
        let chat = JarvisChatClient(client: try makeClient(transport: transport))

        let result = try await chat.piWarm()
        XCTAssertEqual(result, PiWarmResult(state: "warm", alreadyWarm: false, ms: 1800, skipped: nil))
        let skipped = try JSONDecoder().decode(
            PiWarmResult.self,
            from: Data(#"{"state":"cold","alreadyWarm":false,"ms":0,"skipped":"budget_exhausted"}"#.utf8)
        )
        XCTAssertEqual(skipped.skipped, "budget_exhausted")
        do {
            _ = try await chat.piWarm()
            XCTFail("Expected a PI failure")
        } catch {
            XCTAssertEqual(
                error as? JarvisChatClientError,
                .serverEvent(code: "pi_not_configured", message: "PI is not configured.")
            )
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .post])
        XCTAssertEqual(requests.map(\.url.path), ["/api/pi/warm", "/api/pi/warm"])
        XCTAssertEqual(requests.first?.body, Data("{}".utf8))
    }

    private func brainResponse(enabled: Bool, paused: Bool = false, available: Bool = true) -> HTTPResponse {
        let body = #"""
        {"available":\#(available),"enabled":\#(enabled),"updatedAt":"2026-11-16T10:00:00.000Z","paused":\#(paused),
         "budget":{"limitDkk":100,"spentDkk":82.5,"state":"warn"},
         "month":{"wakes":14,"costDkk":1.9},"today":{"messages":2,"usedTurns":3,"allowedTurns":12},
         "lastWake":{"at":"2026-11-16T10:00:00.000Z","totalMs":4100,"inputTokens":12000,"cachedTokens":9000,"outputTokens":300,"costDkk":0.09,"outcome":"ok"},
         "logPending":1,"nextDueAt":"2026-11-16T10:30:00.000Z",
         "slots":{"used":3,"allowed":12,"remaining":9,"lastAt":"2026-11-16T10:00:00.000Z","nextAllowedAt":null,"quiet":false,
                  "queue":{"pending":0,"leased":0,"retrying":0}},
         "situation":{"revision":2,"asOf":"2026-11-16T09:55:00.000Z","updatedAt":"2026-11-16T10:00:00.000Z",
                      "staleSources":[],"missingSources":["weather"],"disabledSources":[]},
         "cost":{"coldSweepMinDkk":0.14,"coldSweepMaxDkk":0.28,"representativeToolTurnDkk":0.17,"preflightWorstCaseDkk":0.79,
                 "estimatedDayMinDkk":1.68,"estimatedDayMaxDkk":3.36,"estimatedThirtyDayMinDkk":50.4,"estimatedThirtyDayMaxDkk":100}}
        """#
        return HTTPResponse(statusCode: 200, body: Data(body.utf8))
    }

    private func proactiveConfigResponse(paused: Bool) throws -> HTTPResponse {
        let config: [String: Any] = [
            "paused": paused, "monthlyBudgetDkk": 50, "backgroundTurnsPerDay": 12,
            "sources": JarvisProactiveSourceID.allCases.map { ["id": $0.rawValue, "enabled": true] as [String: Any] },
            "categories": JarvisProactiveCategory.allCases.map { ["id": $0.rawValue, "enabled": true] as [String: Any] },
            "suggestionScope": "all", "newsFeeds": [], "guidance": "", "preferences": [],
            "revision": String(repeating: "a", count: 64),
        ]
        return HTTPResponse(statusCode: 200, body: try JSONSerialization.data(withJSONObject: config))
    }

    func testProactiveOffWritesOnlyTheBrainFlagAndReopensOff() async throws {
        let transport = RecordingTransport([
            brainResponse(enabled: true),
            brainResponse(enabled: false),
            brainResponse(enabled: false),
        ])
        let appClient = try makeClient(transport: transport)
        let proactive = JarvisProactiveClient(client: appClient)

        let status = try await proactive.backgroundStatus()
        XCTAssertTrue(status.allowsProactiveWakes)
        XCTAssertEqual(status.budget, PiBrainStatus.Budget(limitDkk: 100, spentDkk: 82.5, state: "warn"))
        XCTAssertEqual(status.month.wakes, 14)
        XCTAssertEqual(status.today.messages, 2)
        XCTAssertEqual(status.today.usedTurns, 3)
        XCTAssertEqual(status.slots.remaining, 9)
        XCTAssertEqual(status.situation.revision, 2)
        XCTAssertEqual(status.lastWake?.cachedTokens, 9000)
        XCTAssertEqual(status.nextDueAt, "2026-11-16T10:30:00.000Z")
        XCTAssertEqual(status.logPending, 1)

        let changed = try await proactive.setBackgroundEnabled(false)
        XCTAssertFalse(changed.allowsProactiveWakes)
        let reopened = try await JarvisProactiveClient(client: appClient).backgroundStatus()
        XCTAssertFalse(reopened.allowsProactiveWakes)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .put, .get])
        XCTAssertEqual(requests.map(\.url.path), Array(repeating: "/api/pi/brain", count: 3))
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests[1].body)) as? [String: Any])
        XCTAssertEqual(sent["enabled"] as? Bool, false)
        XCTAssertEqual(sent.count, 1)
    }

    func testProactiveOnResumesAnExistingPauseBeforeEnablingWakes() async throws {
        let transport = RecordingTransport([
            brainResponse(enabled: true, paused: true),
            try proactiveConfigResponse(paused: true),
            try proactiveConfigResponse(paused: false),
            brainResponse(enabled: true),
        ])
        let proactive = JarvisProactiveClient(client: try makeClient(transport: transport))
        let changed = try await proactive.setBackgroundEnabled(true)
        XCTAssertTrue(changed.allowsProactiveWakes)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .get, .patch, .put])
        XCTAssertEqual(requests.map(\.url.path), [
            "/api/pi/brain", "/api/proactive/settings", "/api/proactive/settings", "/api/pi/brain",
        ])
        let revisionPatch = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests[2].body)) as? [String: Any])
        XCTAssertEqual(revisionPatch["paused"] as? Bool, false)
        XCTAssertEqual(revisionPatch["expectedRevision"] as? String, String(repeating: "a", count: 64))
        XCTAssertEqual(revisionPatch.count, 2)
        let switchWrite = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests[3].body)) as? [String: Any])
        XCTAssertEqual(switchWrite["enabled"] as? Bool, true)
        XCTAssertEqual(switchWrite.count, 1)
    }

    func testProactiveOnDoesNotWriteTheBrainFlagAfterAPauseConflict() async throws {
        let paused = brainResponse(enabled: true, paused: true)
        let transport = RecordingTransport([
            paused, paused,
            try proactiveConfigResponse(paused: true),
            HTTPResponse(statusCode: 409),
        ])
        let proactive = JarvisProactiveClient(client: try makeClient(transport: transport))
        let status = try await proactive.backgroundStatus()
        XCTAssertFalse(status.allowsProactiveWakes)
        do {
            _ = try await proactive.setBackgroundEnabled(true)
            XCTFail("A conflicting resume must not report success")
        } catch {
            let requests = await transport.recordedRequests()
            XCTAssertEqual(requests.map(\.method), [.get, .get, .get, .patch])
        }
    }

    func testProactivePageUsesTheSameOffStateAsTheSettingsSwitch() throws {
        let fixtures = [
            (brainResponse(enabled: false), JarvisProactiveStatusLine.off),
            (brainResponse(enabled: true, paused: true), .off),
            (brainResponse(enabled: false, available: false), .unavailable),
            (brainResponse(enabled: true), .quietHours(next: nil)),
        ]
        for (response, expected) in fixtures {
            let background = try JSONDecoder().decode(PiBrainStatus.self, from: response.body)
            let status = JarvisProactiveStatus(
                paused: background.paused, quietNow: true, nextSlotAt: nil, lastRun: nil,
                budget: JarvisProactiveBudget(month: "2026-11", monthlyLimitDkk: 100, estimatedSpendDkk: 0, state: .ok),
                sources: [], background: background
            )
            XCTAssertEqual(JarvisProactiveLogic.statusLine(status), expected)
            if expected == .off {
                XCTAssertFalse(background.allowsProactiveWakes)
                let phrase = JarvisProactivePagePhrase.make(status: status, openItems: 0, language: .en)
                XCTAssertEqual(phrase.plainText, "Dan, proactive suggestions are off.")
            }
        }
    }

    func testPiBrainStatusAndMemoryReadsRemainRetryableAfterUnavailableResponses() async throws {
        let memoryBody = #"""
        {"items":[{"id":"1","type":"memory","title":"Fixture memory","folder":"General","content":"A retained memory"}],
         "count":1,"limit":50,"offset":0,"hasMore":false}
        """#
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 503),
            brainResponse(enabled: false),
            HTTPResponse(statusCode: 503),
            HTTPResponse(statusCode: 200, body: Data(memoryBody.utf8)),
        ])
        let client = try makeClient(
            transport: transport,
            retryPolicy: RetryPolicy(maximumRetries: 0)
        )
        let proactive = JarvisProactiveClient(client: client)
        do {
            _ = try await proactive.backgroundStatus()
            XCTFail("Expected the first Proactive read to fail")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable)
        }
        let brain = try await proactive.backgroundStatus()
        XCTAssertFalse(brain.enabled)

        let settings = JarvisSettingsClient(client: client)
        do {
            _ = try await settings.loadMemory()
            XCTFail("Expected the first Memory read to fail")
        } catch {
            XCTAssertEqual(error as? JarvisSettingsClientError, .unavailable)
        }
        let memory = try await settings.loadMemory()
        XCTAssertEqual(memory.items.map(\.title), ["Fixture memory"])
    }

    func testMemoryClientAdvancesByRawCountWhenLegacyVaultItemsAreFiltered() async throws {
        let memoryBody = #"""
        {"items":[
          {"id":"vault_UGVvc29uYWwvUHJlZmVyZW5jZXMubWQ","type":"vault_note","title":"Legacy note","folder":"Personal","content":"A vault note"},
          {"id":"2","type":"memory","title":"Fixture memory","folder":"General","content":"A retained memory"}
         ],
         "count":2,"limit":50,"offset":0,"hasMore":true}
        """#
        let transport = RecordingTransport([
            HTTPResponse(statusCode: 200, body: Data(memoryBody.utf8)),
        ])
        let settings = JarvisSettingsClient(
            client: try makeClient(transport: transport, retryPolicy: RetryPolicy(maximumRetries: 0))
        )
        let page = try await settings.loadMemory()
        XCTAssertEqual(page.items.map(\.id), ["2"])
        XCTAssertEqual(page.count, 1)
        XCTAssertEqual(page.rawCount, 2)
        XCTAssertEqual(page.nextOffset, 2)
        XCTAssertTrue(page.hasMore)
    }

    func testMemoryClientCanAdvanceAcrossAnAllVaultLegacyPage() async throws {
        let raw = #"""
        {"items":[
          {"id":"vault_b25l","type":"vault_note","title":"One","folder":"Personal","content":"One"},
          {"id":"vault_dHdv","type":"vault_note","title":"Two","folder":"Personal","content":"Two"}
         ],
         "count":2,"limit":50,"offset":50,"hasMore":true}
        """#
        let transport = RecordingTransport([HTTPResponse(statusCode: 200, body: Data(raw.utf8))])
        let settings = JarvisSettingsClient(
            client: try makeClient(transport: transport, retryPolicy: RetryPolicy(maximumRetries: 0))
        )
        let page = try await settings.loadMemory(offset: 50)
        XCTAssertTrue(page.items.isEmpty)
        XCTAssertEqual(page.count, 0)
        XCTAssertEqual(page.rawCount, 2)
        XCTAssertEqual(page.nextOffset, 52)
        XCTAssertTrue(page.hasMore)
    }

    private func makeClient(
        transport: RecordingTransport,
        retryPolicy: RetryPolicy = RetryPolicy()
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: retryPolicy
            ),
            transport: transport,
            tokenStore: StaticTokenStore(),
            accessTokenProvider: StaticTokenProvider()
        )
    }
}

private actor VoiceRecordingSocket: WebSocketTransport {
    private var urls: [URL] = []

    func connect(url: URL, subprotocols: [String]) async throws { urls.append(url) }
    func send(text: String) async throws {}
    func receive() async -> AsyncThrowingStream<String, any Error> { AsyncThrowingStream { $0.finish() } }
    func close(code: UInt16) async {}

    func connectedURLs() -> [URL] { urls }
}

private actor VoiceEndSocket: WebSocketTransport {
    private let failSessionEnd: Bool
    private var continuation: AsyncThrowingStream<String, any Error>.Continuation?
    private var pending: [String] = []
    private var sent: [String] = []
    private var closes: [UInt16] = []

    init(failSessionEnd: Bool = false) {
        self.failSessionEnd = failSessionEnd
    }

    func connect(url: URL, subprotocols: [String]) async throws {}

    func send(text: String) async throws {
        if failSessionEnd && text == #"{"type":"jarvis.session.end"}"# {
            throw VoiceProtocolError.endFailed
        }
        sent.append(text)
    }

    func receive() async -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { continuation in
            self.continuation = continuation
            for text in self.pending { continuation.yield(text) }
            self.pending.removeAll()
        }
    }

    func close(code: UInt16) async {
        closes.append(code)
    }

    func emit(_ text: String) {
        if let continuation {
            continuation.yield(text)
        } else {
            pending.append(text)
        }
    }

    func sentTexts() -> [String] { sent }
    func waitForText(_ expected: String, timeout: Duration) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while !sent.contains(expected), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(1))
        }
        return sent.contains(expected)
    }
    func wasClosed() -> Bool { !closes.isEmpty }
    func closeCodes() -> [UInt16] { closes }
}

private actor VoiceConnectingSocket: WebSocketTransport {
    private var connection: CheckedContinuation<Void, Never>?
    private var connectWaiters: [CheckedContinuation<Void, Never>] = []
    private var closes: [UInt16] = []

    func connect(url: URL, subprotocols: [String]) async throws {
        await withCheckedContinuation {
            connection = $0
            let waiters = connectWaiters
            connectWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
    }

    func send(text: String) async throws {
        throw VoiceProtocolError.invalidState
    }

    func receive() async -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func close(code: UInt16) async {
        closes.append(code)
    }

    func waitUntilConnecting() async {
        if connection != nil { return }
        await withCheckedContinuation { connectWaiters.append($0) }
    }

    func releaseConnection() {
        connection?.resume()
        connection = nil
    }

    func closeCodes() -> [UInt16] { closes }
}

private actor RecordingTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(_ responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.isEmpty ? HTTPResponse(statusCode: 200) : responses.removeFirst()
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }
}

private struct StaticTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private struct StaticTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}
