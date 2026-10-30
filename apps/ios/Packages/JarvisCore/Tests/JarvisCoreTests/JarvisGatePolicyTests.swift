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
}
