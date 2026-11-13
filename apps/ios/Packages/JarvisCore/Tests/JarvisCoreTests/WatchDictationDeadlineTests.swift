import Foundation
import XCTest
@testable import JarvisCore

@MainActor
final class WatchDictationDeadlineTests: XCTestCase {
    @MainActor private final class Sleeper {
        var waits: [CheckedContinuation<Void, Never>] = []
        var durations: [Duration] = []
        var waiter: CheckedContinuation<CheckedContinuation<Void, Never>, Never>?

        func sleep(_ duration: Duration) async {
            durations.append(duration)
            await withCheckedContinuation {
                if let waiter {
                    self.waiter = nil
                    waiter.resume(returning: $0)
                } else {
                    waits.append($0)
                }
            }
        }

        func next() async -> CheckedContinuation<Void, Never> {
            if !waits.isEmpty { return waits.removeFirst() }
            return await withCheckedContinuation { waiter = $0 }
        }
    }

    func testTimeoutFiresOnceAtTwentyFiveSeconds() async {
        let sleeper = Sleeper()
        let deadline = WatchDictationDeadline(sleep: { await sleeper.sleep($0) })
        var timeouts = 0
        var finished: CheckedContinuation<Void, Never>?
        deadline.start { timeouts += 1; finished?.resume(); finished = nil }
        let wait = await sleeper.next()
        XCTAssertEqual(WatchDictationDeadline.seconds, 25)
        XCTAssertEqual(sleeper.durations, [.seconds(25)])
        await withCheckedContinuation { finished = $0; wait.resume() }
        XCTAssertEqual(timeouts, 1)
        deadline.cancel()
        XCTAssertEqual(timeouts, 1)
    }

    func testCancelledOrReplacedDeadlineCannotTimeoutNewDictation() async {
        let sleeper = Sleeper()
        let deadline = WatchDictationDeadline(sleep: { await sleeper.sleep($0) })
        var timeouts: [Int] = []
        var finished: CheckedContinuation<Void, Never>?
        deadline.start { timeouts.append(1) }
        let oldWait = await sleeper.next()
        deadline.cancel()
        deadline.start { timeouts.append(2); finished?.resume(); finished = nil }
        let newWait = await sleeper.next()
        oldWait.resume()
        await withCheckedContinuation { finished = $0; newWait.resume() }
        XCTAssertEqual(timeouts, [2])
    }

    func testTimeoutDoesNotWaitForNonCooperativeFinishingWork() async {
        let sleeper = Sleeper()
        let deadline = WatchDictationDeadline(sleep: { await sleeper.sleep($0) })
        var work: Task<Void, Never>!
        let workWait: CheckedContinuation<Void, Never> = await withCheckedContinuation { ready in
            work = Task {
                await withCheckedContinuation { ready.resume(returning: $0) }
            }
        }
        var timedOut = false
        var finished: CheckedContinuation<Void, Never>?
        deadline.start {
            work.cancel()
            timedOut = true
            finished?.resume()
            finished = nil
        }
        let timerWait = await sleeper.next()
        await withCheckedContinuation { finished = $0; timerWait.resume() }
        XCTAssertTrue(timedOut)
        XCTAssertTrue(work.isCancelled)
        workWait.resume()
        await work.value
    }
}
