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

    func testPlaybackPriorityRespectsAudioOrderAndTerminalBarriers() {
        let id = UUID()
        let audio = WatchEvent(.voiceAudio, requestID: id)
        let state = WatchEvent(.voiceState, requestID: id, text: "Listening")
        let finished = WatchEvent(.voiceState, requestID: id, text: "Playback finished")
        let interrupted = WatchEvent(.interrupt, requestID: id)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, state]), 1)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, finished, state]), 2)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [interrupted]), 1)
        XCTAssertTrue(WatchEventScheduling.isBarrier(finished))
        XCTAssertTrue(WatchEventScheduling.isBarrier(interrupted))
        XCTAssertFalse(WatchEventScheduling.isBarrier(state))
    }
}
