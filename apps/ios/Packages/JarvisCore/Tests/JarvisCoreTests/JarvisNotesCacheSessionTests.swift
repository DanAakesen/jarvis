import XCTest
@testable import JarvisCore

final class JarvisNotesCacheSessionTests: XCTestCase {
    func testReadingHistoryDoesNotReturnAnObsoleteSession() async {
        let storage = SuspendedNotesStorage()
        let cache = JarvisCache(storage: storage)
        await cache.bind(account: "owner")
        await cache.recordNoteOpen(path: "old.md")
        await storage.suspendNextRead()
        let pending = Task { await cache.recentNoteVisits() }
        await storage.waitUntilRead()
        await cache.clear()
        await cache.bind(account: "owner")
        await storage.resumeRead()
        let visits = await pending.value
        XCTAssertTrue(visits.isEmpty)
    }

    func testPinsDoNotReturnAnObsoleteSession() async {
        let storage = SuspendedNotesStorage()
        let cache = JarvisCache(storage: storage)
        await cache.bind(account: "owner")
        await cache.setNotePinned(path: "old.md", pinned: true)
        await storage.suspendNextRead()
        let pending = Task { await cache.pinnedNotePaths() }
        await storage.waitUntilRead()
        await cache.clear()
        await cache.bind(account: "owner")
        await storage.resumeRead()
        let pins = await pending.value
        XCTAssertTrue(pins.isEmpty)
    }

    func testOpeningNoteDoesNotWriteIntoANewSession() async {
        let storage = SuspendedNotesStorage()
        let cache = JarvisCache(storage: storage)
        await cache.bind(account: "owner")
        await storage.suspendNextRead()
        let pending = Task { await cache.recordNoteOpen(path: "old.md") }
        await storage.waitUntilRead()
        await cache.clear()
        await cache.bind(account: "owner")
        await storage.resumeRead()
        await pending.value
        let visits = await cache.recentNoteVisits()
        XCTAssertTrue(visits.isEmpty)
    }

    func testPinningDoesNotWriteIntoANewSession() async {
        let storage = SuspendedNotesStorage()
        let cache = JarvisCache(storage: storage)
        await cache.bind(account: "owner")
        await storage.suspendNextRead()
        let pending = Task { await cache.setNotePinned(path: "old.md", pinned: true) }
        await storage.waitUntilRead()
        await cache.clear()
        await cache.bind(account: "owner")
        await storage.resumeRead()
        await pending.value
        let pins = await cache.pinnedNotePaths()
        XCTAssertTrue(pins.isEmpty)
    }
}

private actor SuspendedNotesStorage: JarvisCacheStorage {
    private var entries: [String: JarvisCacheEntry] = [:]
    private var suspendRead = false
    private var readStarted = false
    private var readWaiter: CheckedContinuation<Void, Never>?
    private var release: CheckedContinuation<Void, Never>?

    func suspendNextRead() { suspendRead = true }

    func waitUntilRead() async {
        if readStarted { return }
        await withCheckedContinuation { readWaiter = $0 }
    }

    func resumeRead() {
        release?.resume()
        release = nil
    }

    func read(account: String, key: String) async -> JarvisCacheEntry? {
        let value = entries["\(account)|\(key)"]
        if suspendRead {
            suspendRead = false
            readStarted = true
            readWaiter?.resume()
            readWaiter = nil
            await withCheckedContinuation { release = $0 }
        }
        return value
    }

    func write(_ entry: JarvisCacheEntry, account: String, key: String) {
        entries["\(account)|\(key)"] = entry
    }

    func remove(account: String, key: String) {
        entries["\(account)|\(key)"] = nil
    }

    func remove(account: String, keyPrefix: String) {
        entries = entries.filter { !$0.key.hasPrefix("\(account)|\(keyPrefix)") }
    }

    func removeAll() { entries.removeAll() }
}
