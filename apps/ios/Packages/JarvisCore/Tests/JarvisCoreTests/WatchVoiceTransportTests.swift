import Foundation
import XCTest
@testable import JarvisCore

final class WatchVoiceTransportTests: XCTestCase {
    func testSequenceAcceptsGapsAndRejectsDuplicatesAndLatePackets() {
        var sequence = WatchVoiceSequence()
        XCTAssertTrue(sequence.accept(0))
        XCTAssertTrue(sequence.accept(2))
        XCTAssertFalse(sequence.accept(2))
        XCTAssertFalse(sequence.accept(1))
        XCTAssertFalse(sequence.accept(nil))
        XCTAssertTrue(sequence.accept(3))
    }

    func testResumedStreamRejectsOldPacketsAndRestartsSequence() {
        let old = UUID()
        let current = UUID()
        var sequence = WatchVoiceSequence(streamID: old)
        XCTAssertTrue(sequence.accept(8, streamID: old.uuidString))
        sequence = WatchVoiceSequence(streamID: current)
        XCTAssertFalse(sequence.accept(9, streamID: old.uuidString))
        XCTAssertFalse(sequence.accept(nil, streamID: current.uuidString))
        XCTAssertTrue(sequence.accept(0, streamID: current.uuidString))
    }

    func testLegacyAudioAndOptionalSequenceEncoding() throws {
        var sequence = WatchVoiceSequence()
        XCTAssertTrue(sequence.accept(nil))
        XCTAssertTrue(sequence.accept(nil))
        let legacy = WatchRequest(action: .audio, itemID: UUID().uuidString, data: Data([0, 0]))
        let encoded = try JSONEncoder().encode(legacy)
        XCTAssertNil(try JSONDecoder().decode(WatchRequest.self, from: encoded).sequence)
        let packet = WatchRequest(action: .audio, itemID: UUID().uuidString, data: Data([0, 0]), sequence: 7)
        XCTAssertEqual(try JSONDecoder().decode(WatchRequest.self, from: JSONEncoder().encode(packet)), packet)
        XCTAssertFalse(WatchRequest(action: .voiceHeartbeat, sequence: 1).isValid)
        let reply = WatchReply(id: packet.id)
        XCTAssertNil(try JSONDecoder().decode(WatchReply.self, from: JSONEncoder().encode(reply)).voicePipeline)
        let capable = WatchReply(id: packet.id, voicePipeline: true)
        XCTAssertEqual(try JSONDecoder().decode(WatchReply.self, from: JSONEncoder().encode(capable)).voicePipeline, true)
    }

    func testTransientDropsRecoverAndSustainedStallIsDetected() {
        let start = Date(timeIntervalSince1970: 100)
        var pressure = WatchVoiceBackpressure(now: start)
        pressure.dropped()
        XCTAssertFalse(pressure.stalled(at: start.addingTimeInterval(4.9)))
        pressure.progressed(at: start.addingTimeInterval(4))
        XCTAssertEqual(pressure.drops, 1)
        XCTAssertFalse(pressure.stalled(at: start.addingTimeInterval(8.9)))
        XCTAssertTrue(pressure.stalled(at: start.addingTimeInterval(9)))
    }

    func testVoiceStartRetriesOnlyQuickTransientFailures() {
        for failure in [WatchFailure.unavailable, .busy] {
            XCTAssertTrue(WatchVoiceRecovery.shouldRetryStart(failure, attempt: 1, elapsed: 2))
            XCTAssertTrue(WatchVoiceRecovery.shouldRetryStart(failure, attempt: WatchVoiceRecovery.startAttempts - 1, elapsed: 2))
            XCTAssertFalse(WatchVoiceRecovery.shouldRetryStart(failure, attempt: WatchVoiceRecovery.startAttempts, elapsed: 2))
            XCTAssertFalse(WatchVoiceRecovery.shouldRetryStart(failure, attempt: 1, elapsed: WatchVoiceRecovery.startRetryWindowSeconds))
        }
        for failure in [WatchFailure.signInRequired, .invalidRequest, .failed, .network] {
            XCTAssertFalse(WatchVoiceRecovery.shouldRetryStart(failure, attempt: 1, elapsed: 0))
        }
        XCTAssertFalse(WatchVoiceRecovery.shouldRetryStart(CancellationError(), attempt: 1, elapsed: 0))
    }

    func testPhoneWaitsLongerThanTheWatchBeforeEndingAGap() {
        // The Watch notices a gap after 3 s, then waits for recovery.
        XCTAssertGreaterThan(WatchVoiceRecovery.phoneGraceSeconds, 3 + WatchVoiceRecovery.reconnectGraceSeconds)
        XCTAssertLessThanOrEqual(WatchVoiceRecovery.phoneGraceSeconds, 15)
    }

    func testPlaybackPriorityRespectsAudioOrderAndTerminalBarriers() {
        let id = UUID()
        let audio = WatchEvent(.voiceAudio, requestID: id)
        let state = WatchEvent(.voiceState, requestID: id, text: "Listening")
        let finished = WatchEvent(.voiceState, requestID: id, text: "Playback finished")
        let endFailed = WatchEvent(.voiceState, requestID: id, text: "End failed")
        let interrupted = WatchEvent(.interrupt, requestID: id)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, state]), 1)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, finished, state]), 2)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [interrupted]), 1)
        XCTAssertTrue(WatchEventScheduling.isBarrier(finished))
        XCTAssertTrue(WatchEventScheduling.isBarrier(endFailed))
        XCTAssertTrue(WatchEventScheduling.isBarrier(interrupted))
        XCTAssertTrue(WatchEventScheduling.isBarrier(state))
        XCTAssertTrue(WatchEventScheduling.isBarrier(
            WatchEvent(.voiceTranscript, requestID: id, text: "Jarvis")
        ))
    }
}
