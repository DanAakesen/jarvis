import XCTest
@testable import JarvisCore

final class ResumeOnceTests: XCTestCase {
    func testBodyRunsOnceEvenWhenTheHandlerFiresAgainOnClose() {
        let once = ResumeOnce()
        var runs = 0
        XCTAssertTrue(once.run { runs += 1 })
        XCTAssertFalse(once.run { runs += 1 })
        XCTAssertEqual(runs, 1)
    }

    func testConcurrentCallersRunTheBodyOnce() async {
        let once = ResumeOnce()
        let counter = Counter()
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<50 { group.addTask { once.run { counter.increment() } } }
        }
        XCTAssertEqual(counter.value, 1)
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
    func increment() { lock.lock(); count += 1; lock.unlock() }
}
