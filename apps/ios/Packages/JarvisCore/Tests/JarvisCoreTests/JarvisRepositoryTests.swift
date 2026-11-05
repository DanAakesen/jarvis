import Foundation
import XCTest
@testable import JarvisCore

private final class Clock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_000)
    var now: Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var validators: [String?] = []
    var calls: Int { lock.withLock { count } }
    var seenValidators: [String?] { lock.withLock { validators } }
    func hit(_ validator: String?) { lock.withLock { count += 1; validators.append(validator) } }
}

private struct Boom: Error {}

final class JarvisRepositoryTests: XCTestCase {
    private func collect(_ stream: AsyncStream<JarvisRepositoryUpdate<[String]>>) async -> [JarvisRepositoryUpdate<[String]>] {
        var all: [JarvisRepositoryUpdate<[String]>] = []
        for await update in stream { all.append(update) }
        return all
    }

    private func make(
        clock: Clock,
        counter: Counter,
        storage: any JarvisCacheStorage = JarvisInMemoryCacheStorage(),
        kind: JarvisRepositoryKind = .notes,
        fetch: @escaping JarvisRepository<[String]>.Fetch
    ) async -> (JarvisCache, JarvisRepository<[String]>) {
        let cache = JarvisCache(storage: storage) { clock.now }
        await cache.bind(account: "dan")
        return (cache, JarvisRepository(cache: cache, kind: kind, fetch: fetch))
    }

    func testFirstOpenFetchesThenFreshWindowMakesNoRequest() async {
        let clock = Clock(), counter = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            return .modified(["a"], validator: "v1")
        }
        let first = await collect(repo.updates())
        XCTAssertEqual(first.count, 2)
        guard case .refreshing = first[0], case .fresh(let value) = first[1] else { return XCTFail("\(first)") }
        XCTAssertEqual(value, ["a"])
        clock.advance(299)
        let second = await collect(repo.updates())
        XCTAssertEqual(second.count, 1)
        guard case .cached(let cached, let stale) = second[0] else { return XCTFail("\(second)") }
        XCTAssertEqual(cached, ["a"])
        XCTAssertFalse(stale)
        XCTAssertEqual(counter.calls, 1)
    }

    func testStaleShowsCachedThenRefreshesWithValidator() async {
        let clock = Clock(), counter = Counter()
        let (_, repo) = await make(clock: clock, counter: counter, kind: .factory) { v in
            counter.hit(v)
            return v == nil ? .modified(["old"], validator: "v1") : .modified(["new"], validator: "v2")
        }
        _ = await collect(repo.updates())
        clock.advance(61)
        let updates = await collect(repo.updates())
        guard updates.count == 2, case .cached(let old, true) = updates[0], case .fresh(let new) = updates[1] else {
            return XCTFail("\(updates)")
        }
        XCTAssertEqual(old, ["old"])
        XCTAssertEqual(new, ["new"])
        XCTAssertEqual(counter.seenValidators, [nil, "v1"])
    }

    func testNotModifiedKeepsValueAndRestartsFreshnessWindow() async {
        let clock = Clock(), counter = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            return v == nil ? .modified(["a"], validator: "v1") : .notModified
        }
        _ = await collect(repo.updates())
        clock.advance(400)
        let updates = await collect(repo.updates())
        guard updates.count == 2, case .fresh(let value) = updates[1] else { return XCTFail("\(updates)") }
        XCTAssertEqual(value, ["a"])
        clock.advance(10)
        _ = await collect(repo.updates())
        XCTAssertEqual(counter.calls, 2)
    }

    func testFailureKeepsCachedData() async {
        let clock = Clock(), counter = Counter()
        let failing = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            if counter.calls > 1 { failing.hit(v); throw Boom() }
            return .modified(["kept"], validator: nil)
        }
        _ = await collect(repo.updates())
        let updates = await collect(repo.updates(force: true))
        guard updates.count == 2, case .failed(_, let cached) = updates[1] else { return XCTFail("\(updates)") }
        XCTAssertEqual(cached, ["kept"])
        let after = await repo.cachedValue()
        XCTAssertEqual(after, ["kept"])
    }

    func testFailureWithoutCacheIsReportedNotEmpty() async {
        let (_, repo) = await make(clock: Clock(), counter: Counter()) { _ in throw Boom() }
        let updates = await collect(repo.updates())
        guard updates.count == 2, case .failed(_, let cached) = updates[1] else { return XCTFail("\(updates)") }
        XCTAssertNil(cached)
    }

    func testRefreshThatNeverReturnsEndsInFailureWithoutCache() async {
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage())
        await cache.bind(account: "dan")
        let repo = JarvisRepository<[String]>(cache: cache, kind: .notes, refreshTimeout: .milliseconds(50)) { _ in
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
            return .modified(["never"], validator: nil)
        }
        let updates = await collect(repo.updates())
        guard updates.count == 2, case .refreshing = updates[0], case .failed(let error, let cached) = updates[1] else {
            return XCTFail("\(updates)")
        }
        XCTAssertEqual(error as? JarvisClientError, .timedOut)
        XCTAssertNil(cached)
        var state = JarvisCardState<[String]>.loading
        for update in updates { state.apply(update) }
        guard case .failed = state else { return XCTFail("state stayed \(state)") }
    }

    func testTimedOutRefreshKeepsCachedValue() async {
        let clock = Clock(), counter = Counter()
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage()) { clock.now }
        await cache.bind(account: "dan")
        let repo = JarvisRepository<[String]>(cache: cache, kind: .notes, refreshTimeout: .milliseconds(50)) { v in
            counter.hit(v)
            if counter.calls == 1 { return .modified(["kept"], validator: nil) }
            try await Task.sleep(for: .seconds(30))
            return .modified(["late"], validator: nil)
        }
        _ = await collect(repo.updates())
        let updates = await collect(repo.updates(force: true))
        guard updates.count == 2, case .failed(let error, let cached) = updates[1] else { return XCTFail("\(updates)") }
        XCTAssertEqual(error as? JarvisClientError, .timedOut)
        XCTAssertEqual(cached, ["kept"])
    }

    func testStreamEndingWhileLoadingBecomesFailure() {
        var state = JarvisCardState<[String]>.loading
        state.finishLoading()
        guard case .failed = state else { return XCTFail("\(state)") }
        var loaded = JarvisCardState<[String]>.loaded(["a"], refreshFailed: false)
        loaded.finishLoading()
        XCTAssertEqual(loaded.value, ["a"])
    }

    func testClientPathsUseHealthNotTheRetiredDailyPrefix() throws {
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources")
        let walker = try XCTUnwrap(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
        var checked = 0
        for case let url as URL in walker where url.pathExtension == "swift" {
            let text = try String(contentsOf: url, encoding: .utf8)
            checked += 1
            XCTAssertFalse(text.contains(#"path: ["daily""#), "\(url.lastPathComponent) requests a retired /daily route")
        }
        XCTAssertGreaterThan(checked, 0)
    }

    func testForceRefreshesWhileFresh() async {
        let clock = Clock(), counter = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            return .modified(["a"], validator: nil)
        }
        _ = await collect(repo.updates())
        _ = await collect(repo.updates(force: true))
        XCTAssertEqual(counter.calls, 2)
    }

    func testInvalidateForcesNextRequest() async {
        let clock = Clock(), counter = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            return .modified(["a"], validator: nil)
        }
        _ = await collect(repo.updates())
        await repo.invalidate()
        _ = await collect(repo.updates())
        XCTAssertEqual(counter.calls, 2)
    }

    func testClearOnSignOutRemovesCache() async {
        let clock = Clock(), counter = Counter()
        let (cache, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            return .modified(["secret-free"], validator: nil)
        }
        _ = await collect(repo.updates())
        await cache.clear()
        let cleared = await repo.cachedValue()
        XCTAssertNil(cleared)
        let account = await cache.currentAccount
        XCTAssertNil(account)
    }

    func testAccountChangeClearsPreviousAccountData() async {
        let clock = Clock(), counter = Counter()
        let (cache, repo) = await make(clock: clock, counter: counter) { _ in .modified(["dan"], validator: nil) }
        _ = await collect(repo.updates())
        await cache.bind(account: "dan")
        let same = await repo.cachedValue()
        XCTAssertEqual(same, ["dan"])
        await cache.bind(account: "other")
        let other = await repo.cachedValue()
        XCTAssertNil(other)
    }

    func testFileStoragePersistsAndClears() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("jarvis-cache-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = JarvisFileCacheStorage(root: root)
        let clock = Clock(), counter = Counter()
        let (cache, repo) = await make(clock: clock, counter: counter, storage: storage) { _ in .modified(["disk"], validator: "e") }
        _ = await collect(repo.updates())
        let reopened = JarvisRepository<[String]>(cache: cache, kind: .notes) { _ in throw Boom() }
        let value = await reopened.cachedValue()
        XCTAssertEqual(value, ["disk"])
        await cache.clear()
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }

    func testInvalidateByKindAndScopeDropsOnlyThatEntry() async {
        let clock = Clock(), counter = Counter()
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage()) { clock.now }
        await cache.bind(account: "dan")
        let items = JarvisRepository<[String]>(cache: cache, kind: .proactive, scope: "items") { _ in .modified(["i"], validator: nil) }
        let runs = JarvisRepository<[String]>(cache: cache, kind: .proactive, scope: "runs") { _ in .modified(["r"], validator: nil) }
        _ = await collect(items.updates())
        _ = await collect(runs.updates())
        await cache.invalidate(kind: .proactive, scope: "items")
        let droppedItems = await items.cachedValue()
        let keptRuns = await runs.cachedValue()
        XCTAssertNil(droppedItems)
        XCTAssertEqual(keptRuns, ["r"])
        XCTAssertEqual(counter.calls, 0)
    }

    func testInvalidateAllDropsEveryScopeOfOneKindOnDiskAndInMemory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("jarvis-cache-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let storages: [any JarvisCacheStorage] = [JarvisInMemoryCacheStorage(), JarvisFileCacheStorage(root: root)]
        for storage in storages {
            let cache = JarvisCache(storage: storage)
            await cache.bind(account: "dan")
            let tree = JarvisRepository<[String]>(cache: cache, kind: .notes, scope: "tree") { _ in .modified(["t"], validator: nil) }
            let folder = JarvisRepository<[String]>(cache: cache, kind: .notes, scope: "folder:Work") { _ in .modified(["f"], validator: nil) }
            let tasks = JarvisRepository<[String]>(cache: cache, kind: .tasks, scope: "open") { _ in .modified(["k"], validator: nil) }
            for repository in [tree, folder, tasks] { _ = await collect(repository.updates()) }
            await cache.invalidateAll(kind: .notes)
            let droppedTree = await tree.cachedValue()
            let droppedFolder = await folder.cachedValue()
            let keptTasks = await tasks.cachedValue()
            XCTAssertNil(droppedTree)
            XCTAssertNil(droppedFolder)
            XCTAssertEqual(keptTasks, ["k"])
        }
    }

    func testResolveReturnsCacheOnlyWithoutRequestAndFallsBackOnFailure() async {
        let clock = Clock(), counter = Counter()
        let shouldFail = Counter()
        let (_, repo) = await make(clock: clock, counter: counter) { v in
            counter.hit(v)
            if shouldFail.calls > 0 { throw Boom() }
            return .modified(["a"], validator: "v1")
        }
        let empty = await repo.resolve(cacheOnly: true)
        XCTAssertNil(empty.value)
        XCTAssertEqual(counter.calls, 0)
        let loaded = await repo.resolve()
        XCTAssertEqual(loaded.value, ["a"])
        XCTAssertNil(loaded.error)
        let instant = await repo.resolve(cacheOnly: true)
        XCTAssertEqual(instant.value, ["a"])
        shouldFail.hit(nil)
        clock.advance(400)
        let fallback = await repo.resolve()
        XCTAssertEqual(fallback.value, ["a"])
        XCTAssertNotNil(fallback.error)
    }

    func testFreshnessWindowsMatchPolicy() {
        XCTAssertEqual(JarvisRepositoryKind.calendar.freshness, .seconds(120))
        XCTAssertEqual(JarvisRepositoryKind.notes.freshness, .seconds(300))
        XCTAssertEqual(JarvisRepositoryKind.factory.freshness, .seconds(60))
    }
}
