import Foundation
import XCTest
@testable import JarvisCore

@MainActor
final class WatchDictationRoutingTests: XCTestCase {
    @MainActor private final class Gate<Value> {
        private var blocked: CheckedContinuation<Value, Never>?
        private var observer: CheckedContinuation<CheckedContinuation<Value, Never>, Never>?

        func wait() async -> Value {
            await withCheckedContinuation { continuation in
                if let observer {
                    self.observer = nil
                    observer.resume(returning: continuation)
                } else { blocked = continuation }
            }
        }

        func next() async -> CheckedContinuation<Value, Never> {
            if let blocked { self.blocked = nil; return blocked }
            return await withCheckedContinuation { observer = $0 }
        }
    }

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

    func testGatewayTimeoutUsesTimeoutRecoveryInsteadOfNetworkFailure() async {
        XCTAssertEqual(WatchDictationError.forHTTPStatus(504), .timedOut)
        XCTAssertNil(WatchDictationError.forHTTPStatus(503))
        for failure in [WatchFailure.unavailable, .network, .failed] {
            do {
                _ = try await WatchDictationRouting.transcribe(direct: {
                    throw WatchDictationError.timedOut
                }, phone: { throw failure })
                XCTFail("Expected timeout")
            } catch {
                XCTAssertEqual(error as? WatchDictationError, .timedOut)
                XCTAssertEqual((error as? WatchDictationError)?.message,
                               "Transcription timed out. Try again, or tap Message to type.")
            }
        }
    }

    func testActionablePhoneErrorsTakePrecedenceOverDirectTimeout() async {
        for failure in [WatchFailure.signInRequired, .credentialStorage, .dictationSetup, .busy] {
            do {
                _ = try await WatchDictationRouting.transcribe(direct: {
                    throw WatchDictationError.timedOut
                }, phone: { throw failure })
                XCTFail("Expected actionable phone failure")
            } catch {
                XCTAssertEqual(error as? WatchFailure, failure)
            }
        }
    }

    func testPhoneSuccessRecoversFromDirectTimeout() async throws {
        let text = try await WatchDictationRouting.transcribe(direct: {
            throw WatchDictationError.timedOut
        }, phone: { "Phone transcript" })
        XCTAssertEqual(text, "Phone transcript")
    }

    func testStalledDirectRequestLeavesTimeForPhoneWithoutWaitingForCancellation() async throws {
        let direct = Gate<String>()
        let timer = Gate<Void>()
        var timerDuration: Duration?
        var phoneCalls = 0
        var directCancelled = false
        var directFinished: CheckedContinuation<Void, Never>?
        let task = Task {
            try await WatchDictationRouting.transcribe(direct: {
                let result = await direct.wait()
                directCancelled = Task.isCancelled
                directFinished?.resume()
                directFinished = nil
                return result
            }, phone: {
                phoneCalls += 1
                return "Phone transcript"
            }, sleep: { duration in
                timerDuration = duration
                await timer.wait()
            })
        }
        let directWait = await direct.next()
        let timerWait = await timer.next()
        XCTAssertEqual(timerDuration, .seconds(22))
        XCTAssertGreaterThan(WatchDictationDeadline.directSeconds, 20)
        XCTAssertLessThan(WatchDictationDeadline.directSeconds, WatchDictationDeadline.seconds)
        timerWait.resume()
        let text = try await task.value
        XCTAssertEqual(text, "Phone transcript")
        XCTAssertEqual(phoneCalls, 1)
        await withCheckedContinuation { directFinished = $0; directWait.resume(returning: "Stale transcript") }
        XCTAssertTrue(directCancelled)
        XCTAssertEqual(phoneCalls, 1)
    }

    func testCancellationDuringStalledDirectDoesNotStartPhoneFallback() async {
        let direct = Gate<String>()
        let timer = Gate<Void>()
        var phoneCalls = 0
        let task = Task {
            try await WatchDictationRouting.transcribe(direct: {
                await direct.wait()
            }, phone: {
                phoneCalls += 1
                return "Unexpected"
            }, sleep: { _ in await timer.wait() })
        }
        let directWait = await direct.next()
        let timerWait = await timer.next()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(phoneCalls, 0)
        directWait.resume(returning: "Stale")
        timerWait.resume()
    }

    func testCancellationBeforeDirectRaceStartsDoesNotLaunchWork() async {
        let race = DirectRace()
        var directCalls = 0
        var timerCalls = 0
        race.finish(.failure(CancellationError()))
        do {
            let _: String = try await withCheckedThrowingContinuation { continuation in
                race.start(continuation: continuation, direct: {
                    directCalls += 1
                    return "Unexpected"
                }, sleep: { _ in timerCalls += 1 })
            }
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(directCalls, 0)
        XCTAssertEqual(timerCalls, 0)
    }

    func testPhoneCancellationTakesPrecedenceOverDirectTimeout() async {
        do {
            _ = try await WatchDictationRouting.transcribe(direct: {
                throw WatchDictationError.timedOut
            }, phone: { throw CancellationError() })
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
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

    func testLateDirectResultAfterCancellationIsDiscarded() async {
        var phoneCalls = 0
        var task: Task<String, Error>!
        let response: CheckedContinuation<String, Never> = await withCheckedContinuation { ready in
            task = Task {
                try await WatchDictationRouting.transcribe(direct: {
                    await withCheckedContinuation { ready.resume(returning: $0) }
                }, phone: {
                    phoneCalls += 1
                    return "Must not run"
                })
            }
        }
        task.cancel()
        response.resume(returning: "Stale transcript")
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(phoneCalls, 0)
    }

    func testLatePhoneResultAfterCancellationIsDiscarded() async {
        var task: Task<String, Error>!
        let response: CheckedContinuation<String, Never> = await withCheckedContinuation { ready in
            task = Task {
                try await WatchDictationRouting.transcribe(direct: nil, phone: {
                    await withCheckedContinuation { ready.resume(returning: $0) }
                })
            }
        }
        task.cancel()
        response.resume(returning: "Stale transcript")
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch { XCTAssertTrue(error is CancellationError) }
    }
}
