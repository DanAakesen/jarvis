import Foundation
import XCTest
@testable import JarvisCore

@MainActor
final class WatchDictationRoutingTests: XCTestCase {
    func testDirectSuccessNeverCallsPhone() async throws {
        var calls: [String] = []
        let text = try await WatchDictationRouting.transcribe(direct: {
            calls.append("direct"); return "Draft only"
        }, phone: {
            calls.append("phone"); return "Wrong route"
        })
        XCTAssertEqual(text, "Draft only")
        XCTAssertEqual(calls, ["direct"])
    }

    func testDirectFailureFallsBackExactlyOnce() async throws {
        var calls: [String] = []
        let text = try await WatchDictationRouting.transcribe(direct: {
            calls.append("direct"); throw WatchFailure.network
        }, phone: {
            calls.append("phone"); return "Phone transcript"
        }, onDirectFailure: { _ in calls.append("failure") })
        XCTAssertEqual(text, "Phone transcript")
        XCTAssertEqual(calls, ["direct", "failure", "phone"])
    }

    func testMissingCredentialUsesPhoneWithoutClaimingSignedOut() async throws {
        let text = try await WatchDictationRouting.transcribe(direct: nil, phone: { "Phone transcript" })
        XCTAssertEqual(text, "Phone transcript")
        do {
            _ = try await WatchDictationRouting.transcribe(direct: nil, phone: { throw WatchFailure.unavailable })
            XCTFail("Expected setup guidance")
        } catch {
            XCTAssertEqual(error as? WatchFailure, .dictationSetup)
            XCTAssertNotEqual(error as? WatchFailure, .signInRequired)
        }
    }

    func testPhoneAuthenticationFailureTakesPrecedenceOverDirectNetworkFailure() async {
        do {
            _ = try await WatchDictationRouting.transcribe(direct: { throw WatchFailure.network },
                                                           phone: { throw WatchFailure.signInRequired })
            XCTFail("Expected authentication guidance")
        } catch { XCTAssertEqual(error as? WatchFailure, .signInRequired) }
    }

    func testUnavailablePhonePreservesMeaningfulDirectError() async {
        for failure in [WatchFailure.network, .signInRequired, .credentialStorage] {
            do {
                _ = try await WatchDictationRouting.transcribe(direct: { throw failure },
                                                               phone: { throw WatchFailure.unavailable })
                XCTFail("Expected direct error")
            } catch { XCTAssertEqual(error as? WatchFailure, failure) }
        }
    }

    func testTransientPhoneLossDoesNotCancelDirectTranscription() async throws {
        var reachable = true
        var phoneCalls = 0
        let text = try await WatchDictationRouting.transcribe(direct: {
            reachable = false
            await Task.yield()
            try Task.checkCancellation()
            reachable = true
            return "Retained recording"
        }, phone: {
            phoneCalls += 1
            throw WatchFailure.unavailable
        })
        XCTAssertEqual(text, "Retained recording")
        XCTAssertTrue(reachable)
        XCTAssertEqual(phoneCalls, 0)
    }

    func testCancellationNeverFallsBackOrReportsAuthentication() async {
        for failure: Error in [CancellationError(), URLError(.cancelled)] {
            var phoneCalls = 0
            var reportedFailures = 0
            do {
                _ = try await WatchDictationRouting.transcribe(direct: { throw failure }, phone: {
                    phoneCalls += 1
                    return "Must not run"
                }, onDirectFailure: { _ in reportedFailures += 1 })
                XCTFail("Expected cancellation")
            } catch { XCTAssertTrue(error is CancellationError) }
            XCTAssertEqual(phoneCalls, 0)
            XCTAssertEqual(reportedFailures, 0)
        }
    }

    func testAlreadyCancelledOperationDoesNotStartEitherTransport() async {
        var calls = 0
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await WatchDictationRouting.transcribe(direct: {
                calls += 1; return "Must not run"
            }, phone: {
                calls += 1; return "Must not run"
            })
        }
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(calls, 0)
    }
}
