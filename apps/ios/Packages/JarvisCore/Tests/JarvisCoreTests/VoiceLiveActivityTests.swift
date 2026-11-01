import Foundation
import XCTest
@testable import JarvisCore

final class VoiceLiveActivityTests: XCTestCase {
    func testManualRetryDismissesOldActivityBeforeStartingReplacement() throws {
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { repository.deleteLastPathComponent() }
        let source = try String(
            contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/VoiceScreenModel.swift"),
            encoding: .utf8
        )
        let retry = try XCTUnwrap(source.components(separatedBy: "func retryNow() async {").last?
            .components(separatedBy: "func openSettings()").first)
        XCTAssertTrue(retry.contains("!isStarting, !isEnding"))
        XCTAssertTrue(retry.contains("isStarting = true"))
        XCTAssertTrue(retry.contains("liveActivitySessionID = nil"))
        XCTAssertTrue(retry.contains("sessionGeneration == retryGeneration"))
        let stop = try XCTUnwrap(retry.range(of: "stopAudio()"))
        let dismiss = try XCTUnwrap(retry.range(of: "await liveActivity.end()"))
        let start = try XCTUnwrap(retry.range(of: "await start()"))
        XCTAssertLessThan(stop.lowerBound, dismiss.lowerBound)
        XCTAssertLessThan(dismiss.lowerBound, start.lowerBound)
    }

    func testPhaseTracksSpeechMuteThinkingAndReconnect() {
        XCTAssertEqual(VoiceLiveActivityPhase(state: .listening, isMuted: false), .listening)
        XCTAssertEqual(VoiceLiveActivityPhase(state: .speaking, isMuted: false), .speaking)
        XCTAssertEqual(VoiceLiveActivityPhase(state: .speaking, isMuted: true), .muted)
        XCTAssertEqual(VoiceLiveActivityPhase(state: .ready, isMuted: false), .thinking)
        XCTAssertEqual(VoiceLiveActivityPhase(state: .connecting, isMuted: false), .connecting)
        XCTAssertEqual(VoiceLiveActivityPhase(state: .reconnecting(attempt: 2), isMuted: true), .reconnecting)
    }

    func testAllCopyHasDanishDefaultAndEnglishResources() {
        XCTAssertEqual(VoiceLiveActivityCopy.listening.text(), "Lytter")
        XCTAssertEqual(VoiceLiveActivityCopy.listening.text(language: .en), "Listening")
        for language in JarvisAppLanguage.allCases {
            for key in VoiceLiveActivityCopy.allCases {
                XCTAssertFalse(key.text(language: language).isEmpty)
                XCTAssertNotEqual(key.text(language: language), key.rawValue)
            }
        }
    }

    func testWaveformUsesRealBoundedPCM16Levels() {
        XCTAssertEqual(VoiceWaveform.sampleCount, 26)
        XCTAssertEqual(VoiceWaveform.level(pcm16: Data([0, 0, 0, 0])), 0)
        XCTAssertEqual(VoiceWaveform.level(pcm16: Data([0xFF, 0x7F, 0, 0x80])), 1)
        XCTAssertEqual(VoiceWaveform.level(pcm16: Data([0, 0x10, 0, 0xF0])), 0.5, accuracy: 0.001)
        XCTAssertEqual(VoiceWaveform.level(pcm16: Data()), 0)
        XCTAssertEqual(VoiceWaveform.level(pcm16: Data([1])), 0)
    }

    @MainActor
    func testControlsReachExistingSessionAndRejectStaleOrEndedSession() async throws {
        let session = ActivitySession()
        let id = try XCTUnwrap(session.liveActivitySessionID)
        VoiceLiveActivityActions.session = session
        defer { VoiceLiveActivityActions.session = nil }

        try await VoiceLiveActivityActions.perform(sessionID: id, command: .setMuted(true))
        try await VoiceLiveActivityActions.perform(sessionID: id, command: .setMuted(true))
        XCTAssertTrue(session.isMuted)
        try await VoiceLiveActivityActions.perform(sessionID: id, command: .setMuted(false))
        XCTAssertFalse(session.isMuted)

        session.liveActivitySessionID = UUID()
        do {
            try await VoiceLiveActivityActions.perform(sessionID: id, command: .end)
            XCTFail("An old activity must not end a replacement session")
        } catch {
            XCTAssertTrue(error is VoiceLiveActivityError)
        }
        let replacement = try XCTUnwrap(session.liveActivitySessionID)
        try await VoiceLiveActivityActions.perform(sessionID: replacement, command: .end)
        XCTAssertNil(session.liveActivitySessionID)
        do {
            try await VoiceLiveActivityActions.perform(sessionID: replacement, command: .setMuted(false))
            XCTFail("An ended session cannot be controlled")
        } catch {
            XCTAssertTrue(error is VoiceLiveActivityError)
        }
    }

    @MainActor
    func testControlsDoNotRetainOrRestartSessionAndPropagateFailure() async throws {
        var session: ActivitySession? = ActivitySession()
        let id = try XCTUnwrap(session?.liveActivitySessionID)
        VoiceLiveActivityActions.session = session
        defer { VoiceLiveActivityActions.session = nil }
        session?.shouldFail = true
        do {
            try await VoiceLiveActivityActions.perform(sessionID: id, command: .setMuted(true))
            XCTFail("A failed command must not report success")
        } catch {
            XCTAssertTrue(error is ActivitySession.Failure)
        }
        session = nil
        XCTAssertNil(VoiceLiveActivityActions.session)
        do {
            try await VoiceLiveActivityActions.perform(sessionID: id, command: .end)
            XCTFail("No session must fail closed")
        } catch {
            XCTAssertTrue(error is VoiceLiveActivityError)
        }
    }
}

@MainActor
private final class ActivitySession: VoiceLiveActivityControlling {
    enum Failure: Error { case unavailable }
    var liveActivitySessionID: UUID? = UUID()
    var isMuted = false
    var shouldFail = false

    func performLiveActivityCommand(_ command: VoiceLiveActivityCommand) async throws {
        if shouldFail { throw Failure.unavailable }
        switch command {
        case .setMuted(let muted): isMuted = muted
        case .end: liveActivitySessionID = nil
        }
    }
}
