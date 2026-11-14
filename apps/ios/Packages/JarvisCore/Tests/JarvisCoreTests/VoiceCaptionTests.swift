import XCTest
@testable import JarvisCore

final class VoiceCaptionTests: XCTestCase {
    func testUserDeltasDecodeAndAccumulateUntilFinalTranscript() {
        var captions = VoiceCaptions()
        let first = VoiceServerMessage.decode(
            #"{"type":"conversation.item.input_audio_transcription.delta","item_id":"user-1","delta":"Hello "}"#
        )
        XCTAssertEqual(first, .transcriptionDelta(delta: "Hello ", itemID: "user-1"))
        captions.receive(first)
        captions.receive(.transcriptionDelta(delta: "there", itemID: "user-1"))
        XCTAssertEqual(captions.user, "Hello there")

        captions.receive(.transcriptionCompleted(transcript: "Hello there!", itemID: "user-1"))
        XCTAssertEqual(captions.user, "Hello there!")
        captions.receive(.transcriptionDelta(delta: "Next turn", itemID: "user-2"))
        XCTAssertEqual(captions.user, "Next turn")
    }

    func testLongCaptionsKeepAllTextAndResetForNewSpeechAndResponses() {
        var captions = VoiceCaptions()
        let chunk = String(repeating: "A", count: 3_000)
        captions.receive(.transcriptionDelta(delta: chunk, itemID: "user"))
        captions.receive(.transcriptionDelta(delta: chunk, itemID: "user"))
        captions.receive(.responseCreated(responseID: "one"))
        for _ in 0..<4 {
            captions.receive(.assistantTranscriptDelta(chunk))
        }
        XCTAssertEqual(captions.user, chunk + chunk)
        XCTAssertEqual(captions.assistant, String(repeating: chunk, count: 4))

        captions.receive(.responseCreated(responseID: "two"))
        XCTAssertEqual(captions.assistant, "")
        XCTAssertEqual(captions.user, chunk + chunk)
        captions.receive(.assistantTranscriptDelta("New reply"))
        captions.receive(.speechStarted)
        XCTAssertEqual(captions.user, "")
        XCTAssertEqual(captions.assistant, "")
    }

    func testWatchUserDeltaEventRoundTrips() throws {
        let event = WatchEvent(.voiceUserTranscriptDelta, requestID: UUID(), text: "Hello ", responseID: "user-1")
        let decoded = try JSONDecoder().decode(WatchEvent.self, from: JSONEncoder().encode(event))
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
}
