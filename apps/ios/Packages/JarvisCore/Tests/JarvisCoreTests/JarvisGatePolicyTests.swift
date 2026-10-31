import Foundation
import XCTest
@testable import JarvisCore

final class JarvisGatePolicyTests: XCTestCase {
    func testColdStartLocksWithOrWithoutBackgroundTimestamp() {
        let policy = JarvisGatePolicy()

        XCTAssertTrue(policy.shouldLock(lastBackgroundedAt: nil, now: Date(), isColdStart: true))
        XCTAssertTrue(policy.shouldLock(lastBackgroundedAt: Date(), now: Date(), isColdStart: true))
    }

    func testBackgroundIntervalLocksAtThresholdAndNotBefore() {
        let policy = JarvisGatePolicy()
        let backgroundedAt = Date(timeIntervalSince1970: 1_000)

        XCTAssertFalse(policy.shouldLock(
            lastBackgroundedAt: backgroundedAt,
            now: backgroundedAt.addingTimeInterval(59.9)
        ))
        XCTAssertTrue(policy.shouldLock(
            lastBackgroundedAt: backgroundedAt,
            now: backgroundedAt.addingTimeInterval(60)
        ))
    }

    func testMissingBackgroundTimestampDoesNotRelockAnActiveSession() {
        XCTAssertFalse(JarvisGatePolicy().shouldLock(lastBackgroundedAt: nil, now: Date()))
    }

    func testMissingOrExpiredTokenRequiresSignIn() {
        let policy = JarvisGatePolicy()

        XCTAssertEqual(policy.decision(tokenPresent: false, isLocked: false), .signIn)
        XCTAssertEqual(policy.decision(tokenPresent: true, tokenExpired: true, isLocked: false), .signIn)
    }

    func testDeniedAccountAlwaysRequiresSignOut() {
        XCTAssertEqual(
            JarvisGatePolicy().decision(
                tokenPresent: true,
                tokenExpired: false,
                accountDenied: true,
                isLocked: false
            ),
            .denied
        )
    }

    func testValidTokenRoutesToLockOrContent() {
        let policy = JarvisGatePolicy()

        XCTAssertEqual(policy.decision(tokenPresent: true, isLocked: true), .locked)
        XCTAssertEqual(policy.decision(tokenPresent: true, isLocked: false), .unlocked)
    }

    func testNegativeLockIntervalIsClampedToZero() {
        let policy = JarvisGatePolicy(lockInterval: -1)
        let backgroundedAt = Date(timeIntervalSince1970: 1_000)

        XCTAssertTrue(policy.shouldLock(lastBackgroundedAt: backgroundedAt, now: backgroundedAt))
    }

    @MainActor
    func testSignInTimeoutLeavesSpinnerAndIgnoresCancellationAndLateCallbacks() async {
        let request = JarvisSignInRequest(sleep: { duration in
            XCTAssertEqual(duration, .seconds(120))
        })
        var completion: JarvisSignInRequest.Completion?
        var cancelled = false
        var state = JarvisSignInState.signingIn

        do {
            _ = try await request.token(start: { completion = $0 }, cancel: {
                cancelled = true
                completion?(.failure(CancellationError()))
            })
            XCTFail("A missing callback must time out")
        } catch {
            XCTAssertTrue(error is JarvisSignInRequestError)
            state = .recovering(from: error)
        }

        XCTAssertTrue(cancelled)
        XCTAssertEqual(state, .failed)
        completion?(.success("synthetic-late-token"))
        completion?(.failure(CancellationError()))
        XCTAssertEqual(state, .failed)
    }

    @MainActor
    func testSignInCallbackFailureLeavesSpinner() async {
        struct PresentationUnavailable: Error {}
        let request = JarvisSignInRequest()
        do {
            _ = try await request.token(start: {
                $0(.failure(PresentationUnavailable()))
            }, cancel: { XCTFail("An already completed request must not be cancelled") })
            XCTFail("Presentation failure must throw")
        } catch {
            XCTAssertEqual(JarvisSignInState.recovering(from: error), .failed)
        }
    }

    @MainActor
    func testCancelledSignInSheetReturnsToIdle() async {
        let request = JarvisSignInRequest()
        do {
            _ = try await request.token(start: {
                $0(.failure(CancellationError()))
            }, cancel: { XCTFail("The sheet already cancelled") })
            XCTFail("Sheet cancellation must throw")
        } catch {
            XCTAssertEqual(JarvisSignInState.recovering(from: error), .idle)
        }
    }

    @MainActor
    func testTaskCancellationReleasesMissingCallback() async {
        var completion: JarvisSignInRequest.Completion?
        var cancelled = false
        let task = Task {
            try await JarvisSignInRequest().token(start: {
                completion = $0
            }, cancel: { cancelled = true })
        }
        while completion == nil { await Task.yield() }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Task cancellation must throw")
        } catch {
            XCTAssertEqual(JarvisSignInState.recovering(from: error), .idle)
        }
        XCTAssertTrue(cancelled)
        completion?(.success("synthetic-late-token"))
    }

    @MainActor
    func testSuccessfulSignInDoesNotCancelAndIgnoresDuplicateCallbacks() async throws {
        let request = JarvisSignInRequest()
        let token = try await request.token(start: {
            $0(.success("synthetic-token"))
            $0(.failure(CancellationError()))
        }, cancel: { XCTFail("A completed sign-in must not be cancelled") })
        XCTAssertEqual(token, "synthetic-token")
        await Task.yield()
    }

    func testSignInRecoveryPreservesDeniedAndOfflineStates() {
        XCTAssertEqual(JarvisSignInState.recovering(from: JarvisClientError.notOwner), .denied)
        for error in [JarvisClientError.networkFailure, .timedOut, .serviceUnavailable] {
            XCTAssertEqual(JarvisSignInState.recovering(from: error), .offline)
        }
        XCTAssertEqual(JarvisSignInState.recovering(from: JarvisClientError.tokenStoreFailure), .failed)
        for language in JarvisAppLanguage.allCases {
            XCTAssertFalse(JarvisNotesLocalization.string(.gateFailed, language: language).isEmpty)
            XCTAssertFalse(JarvisNotesLocalization.string(.gateRetry, language: language).isEmpty)
        }
    }
}
