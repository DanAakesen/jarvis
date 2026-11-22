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

    @MainActor
    func testPlaybackCompletionIsDeliveredAfterCaptureRetryClearsTheHandler() async throws {
        var ledger = VoicePlaybackLedger()
        var machine = VoiceSessionStateMachine()
        for event in [VoiceSessionEvent.start, .connected, .sessionReady] { machine.apply(event) }
        var handler: ((VoicePlaybackLedger.Receipt) -> Void)?
        var attempts = 0
        var resets = 0
        try await WatchVoiceRecovery.startCapture(isCurrent: { true }, start: {
            attempts += 1
            if attempts == 1 { throw WatchFailure.unavailable }
        }, onFailure: { _, _ in
            resets += 1
            // Like VoiceAudioEngine.stop(), a failed start resets both the ledger and the handler.
            ledger = VoicePlaybackLedger()
            handler = nil
        }, onReady: {
            handler = { machine.apply(.playbackFinished(responseID: $0.responseID)) }
        }, wait: {})

        machine.apply(.responseCreated(id: "reply"))
        machine.apply(.audioDelta(responseID: "reply"))
        ledger.bufferScheduled(responseID: "reply")
        machine.apply(.responseFinished(responseID: "reply"))
        XCTAssertNil(ledger.responseFinished(responseID: "reply"))
        XCTAssertEqual(machine.state, .speaking)
        handler?(try XCTUnwrap(ledger.bufferPlayed(responseID: "reply")))
        XCTAssertEqual(machine.state, .listening)
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(resets, 1)
    }

    @MainActor
    func testCaptureRecoveryStopsWhenTheRecordingIsReplacedDuringRetry() async {
        var current = true
        var attempts = 0
        do {
            try await WatchVoiceRecovery.startCapture(isCurrent: { current }, start: {
                attempts += 1
                throw WatchFailure.unavailable
            }, onFailure: { _, _ in }, onReady: {
                XCTFail("A cancelled capture must not configure playback")
            }, wait: { current = false })
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(attempts, 1)
    }

    @MainActor
    func testCaptureRecoveryExhaustsRetriesWithoutReportingReady() async {
        var failedAttempts: [Int] = []
        do {
            try await WatchVoiceRecovery.startCapture(isCurrent: { true }, start: {
                throw WatchFailure.unavailable
            }, onFailure: { attempt, _ in failedAttempts.append(attempt) }, onReady: {
                XCTFail("An unavailable microphone must not be reported ready")
            }, wait: {})
            XCTFail("Expected the capture failure")
        } catch { XCTAssertEqual(error as? WatchFailure, .unavailable) }
        XCTAssertEqual(failedAttempts, [1, 2, 3])
    }

    @MainActor
    func testReconnectWaitsForHeartbeatEvenAfterReachabilityFlaps() async throws {
        var time = ContinuousClock.now
        var attempts = 0
        try await WatchVoiceRecovery.reconnect(now: { time }, wait: { time = time.advanced(by: $0) }) { _ in
            attempts += 1
            if attempts < 3 { throw WatchFailure.unavailable }
        }
        XCTAssertEqual(attempts, 3)
    }

    @MainActor
    func testReconnectIncludesUnansweredHeartbeatsInTheDeadline() async {
        let start = ContinuousClock.now
        var time = start
        var budgets: [Duration] = []
        do {
            try await WatchVoiceRecovery.reconnect(now: { time }, wait: { time = time.advanced(by: $0) }) { timeout in
                budgets.append(timeout)
                // The first reply fails quickly; the last must get less than the usual two seconds.
                time = time.advanced(by: budgets.count == 1 ? .seconds(1) : timeout)
                throw WatchFailure.unavailable
            }
            XCTFail("A missing phone must not report a reconnection")
        } catch { XCTAssertEqual(error as? WatchFailure, .unavailable) }
        XCTAssertEqual(budgets, [.seconds(2), .seconds(2), .seconds(2), .seconds(2), .seconds(1)])
        XCTAssertEqual(start.duration(to: time), .seconds(10))
    }

    @MainActor
    func testReconnectDoesNotRetryWhenThePhoneSessionHasEnded() async {
        do {
            try await WatchVoiceRecovery.reconnect(wait: { _ in XCTFail("No retry after the session ended") }) { _ in
                throw WatchFailure.invalidRequest
            }
            XCTFail("Expected the missing session failure")
        } catch { XCTAssertEqual(error as? WatchFailure, .invalidRequest) }
    }

    func testPhoneGraceCoversTheWatchWindowEvenAfterADebouncedDisconnect() {
        // The disconnect callback can take 3 s; active voice can start recovery sooner.
        XCTAssertGreaterThan(WatchVoiceRecovery.phoneGraceSeconds, 3 + WatchVoiceRecovery.reconnectGraceSeconds)
        XCTAssertLessThanOrEqual(WatchVoiceRecovery.phoneGraceSeconds, 15)
    }

    func testRouteRecoveryIgnoresSettledRoutesAndCapsRestartsInARollingWindow() {
        let start = ContinuousClock.now
        var budget = WatchVoiceRecovery.RouteBudget()
        XCTAssertEqual(budget.decide(needsRestart: false, at: start), .unchanged)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start), .restart)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start.advanced(by: .seconds(4))), .restart)
        XCTAssertEqual(budget.decide(needsRestart: false, at: start.advanced(by: .seconds(5))), .unchanged)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start.advanced(by: .milliseconds(9_999))), .exhausted)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start.advanced(by: .seconds(10))), .restart)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start.advanced(by: .seconds(11))), .exhausted)
        XCTAssertEqual(budget.decide(needsRestart: true, at: start.advanced(by: .seconds(14))), .restart)
    }

    func testPlaybackPriorityRespectsAudioOrderAndTerminalBarriers() {
        let id = UUID()
        let audio = WatchEvent(.voiceAudio, requestID: id)
        let state = WatchEvent(.voiceState, requestID: id, text: "Listening")
        let finished = WatchEvent(.voiceState, requestID: id, text: "Playback finished")
        let endFailed = WatchEvent(.voiceState, requestID: id, text: "End failed")
        let interrupted = WatchEvent(.interrupt, requestID: id)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, state]), 2)
        XCTAssertEqual(WatchEventScheduling.insertionIndex(for: audio, in: [audio, finished, state]), 3)
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
