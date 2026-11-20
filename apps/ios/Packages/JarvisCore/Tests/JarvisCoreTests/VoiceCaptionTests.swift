import XCTest
@testable import JarvisCore

final class VoiceCaptionTests: XCTestCase {
    func testUserDeltasDecodeAndAccumulateUntilFinalTranscript() {
        var captions = VoiceCaptions()
        let first = VoiceServerMessage.decode(
            #"{"type":"jarvis.voice.input_transcript.delta","itemId":"user-1","delta":"Hello ","eventId":"input-1"}"#
        )
        XCTAssertEqual(first, .transcriptionDelta(delta: "Hello ", itemID: "user-1", eventID: "input-1"))
        captions.receive(first)
        captions.receive(.transcriptionDelta(delta: "there", itemID: "user-1", eventID: "input-2"))
        XCTAssertEqual(captions.user, "Hello there")

        captions.receive(.transcriptionCompleted(transcript: "Hello there!", itemID: "user-1"))
        XCTAssertEqual(captions.user, "Hello there!")
        captions.receive(.transcriptionDelta(delta: "Next turn", itemID: "user-2", eventID: "input-3"))
        XCTAssertEqual(captions.user, "Next turn")
    }

    func testCaptionTimelinePreservesEverySpeakerAndResponseAcrossOverlap() {
        var captions = VoiceCaptions()
        let chunk = String(repeating: "A", count: 3_000)
        captions.receive(.transcriptionDelta(delta: chunk, itemID: "user", eventID: "user-1"))
        captions.receive(.transcriptionDelta(delta: chunk, itemID: "user", eventID: "user-2"))
        captions.receive(.responseCreated(responseID: "one", delegationID: "delegation-1"))
        for _ in 0..<4 {
            captions.receive(.assistantTranscriptDelta(
                delta: chunk,
                responseID: "one",
                eventID: UUID().uuidString
            ))
        }
        XCTAssertEqual(captions.user, chunk + chunk)
        XCTAssertEqual(captions.assistant, String(repeating: chunk, count: 4))

        captions.receive(.transcriptionDelta(
            delta: "Next turn",
            itemID: "user-next",
            eventID: "user-next-1"
        ))
        captions.receive(.responseCreated(responseID: "two", delegationID: "delegation-2"))
        captions.receive(.assistantTranscriptDelta(
            delta: "New reply",
            responseID: "two",
            eventID: "reply-2"
        ))

        XCTAssertEqual(captions.user, "Next turn")
        XCTAssertEqual(captions.assistant, "New reply")
        XCTAssertEqual(captions.entries.map(\.speaker), [.dan, .jarvis, .dan, .jarvis])
        XCTAssertEqual(captions.entries.map(\.id), ["user", "one", "user-next", "two"])
        XCTAssertEqual(captions.entries[1].text, String(repeating: chunk, count: 4))
    }

    func testLateAndDuplicateAssistantDeltasKeepTheOriginalEntryAndSpeaker() {
        var captions = VoiceCaptions()
        captions.receive(.transcriptionDelta(
            delta: "Please try again",
            itemID: "user-1",
            eventID: "input-1"
        ))
        captions.receive(.responseCreated(responseID: "response-1", delegationID: "delegation-1"))
        captions.receive(.assistantTranscriptDelta(
            delta: "I could not save it. ",
            responseID: "response-1",
            eventID: "assistant-1"
        ))
        captions.receive(.transcriptionDelta(
            delta: "Correct it",
            itemID: "user-2",
            eventID: "input-2"
        ))
        captions.receive(.assistantTranscriptDelta(
            delta: "Try once more.",
            responseID: "response-1",
            eventID: "assistant-2"
        ))
        captions.receive(.assistantTranscriptDelta(
            delta: "Try once more.",
            responseID: "response-1",
            eventID: "assistant-2"
        ))

        XCTAssertEqual(captions.entries.map(\.id), ["user-1", "response-1", "user-2"])
        XCTAssertEqual(captions.entries.map(\.speaker), [.dan, .jarvis, .dan])
        XCTAssertEqual(captions.entries[1].text, "I could not save it. Try once more.")
    }

    func testVoiceProtocolDecodeRetainsResponseAndDeltaIdentity() {
        let started = VoiceServerMessage.decode(
            #"{"type":"jarvis.voice.response.started","responseId":"voice_1","delegationId":"delegate-1"}"#
        )
        XCTAssertEqual(started, .responseCreated(responseID: "voice_1", delegationID: "delegate-1"))

        let transcript = VoiceServerMessage.decode(
            #"{"type":"jarvis.voice.output_transcript.delta","responseId":"voice_1","delta":"Exact","eventId":"output-1"}"#
        )
        XCTAssertEqual(
            transcript,
            .assistantTranscriptDelta(delta: "Exact", responseID: "voice_1", eventID: "output-1")
        )

        let completed = VoiceServerMessage.decode(
            #"{"type":"jarvis.voice.response.completed","responseId":"voice_1"}"#
        )
        XCTAssertEqual(completed, .responseDone(responseID: "voice_1"))
    }

    func testWatchUserDeltaEventRoundTrips() throws {
        let event = WatchEvent(.voiceUserTranscriptDelta, requestID: UUID(), text: "Hello ", responseID: "user-1")
        let decoded = try JSONDecoder().decode(WatchEvent.self, from: JSONEncoder().encode(event))
        XCTAssertEqual(decoded.deliveryID, event.deliveryID)
        XCTAssertEqual(decoded.version, 2)
        XCTAssertEqual(decoded.kind, .voiceUserTranscriptDelta)
        XCTAssertEqual(decoded.text, "Hello ")
        XCTAssertEqual(decoded.responseID, "user-1")
    }

    func testWatchVoiceChunksPreserveLongUnicodeTextWithinWireLimit() throws {
        let text = String(repeating: "🏋️‍♀️\n\"\\", count: 4_000)
        let chunks = WatchLimits.voiceTextChunks(text)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.joined(), text)
        for chunk in chunks {
            XCTAssertLessThanOrEqual(chunk.utf8.count, 4_000)
            let event = WatchEvent(.voiceUserTranscriptDelta, requestID: UUID(), text: chunk, responseID: "user-1")
            XCTAssertLessThan(try WatchCodec.encode(WatchWire.event(event)).count, WatchLimits.wireBytes)
        }
        XCTAssertEqual(WatchLimits.voiceTextChunks(""), [""])
    }

    func testWatchHistoryUsesExplicitRolesWithoutOwnerGuessing() throws {
        let value = WatchHistoryMessage(id: "42", role: .jarvis, text: "Jarvis owns this reply.")
        let decoded = try JSONDecoder().decode(
            WatchHistoryMessage.self,
            from: JSONEncoder().encode(value)
        )
        XCTAssertEqual(decoded.role, .jarvis)
        XCTAssertEqual(decoded.text, "Jarvis owns this reply.")
    }

    func testRestoredWatchHistoryUsesMessageOrderWhenTimestampsTie() throws {
        func message(id: String, role: ConversationRole) throws -> ChatHistoryMessage {
            let raw = """
            {"id":"\(id)","sessionId":"9","channel":"voice","language":"en",
             "role":"\(role.rawValue)","text":"\(id)","model":null,"interrupted":false,
             "voiceMinutes":null,"at":"2026-11-20T12:00:00.000Z",
             "toolCalls":[],"attachments":[],"blocks":[]}
            """
            return try JSONDecoder().decode(ChatHistoryMessage.self, from: Data(raw.utf8))
        }

        let messages = try [
            message(id: "104", role: .jarvis),
            message(id: "102", role: .jarvis),
            message(id: "101", role: .dan),
            message(id: "103", role: .dan),
        ]
        XCTAssertEqual(
            ChatHistoryOrdering.ordered(messages).map(\.id),
            ["101", "102", "103", "104"]
        )
    }
}
