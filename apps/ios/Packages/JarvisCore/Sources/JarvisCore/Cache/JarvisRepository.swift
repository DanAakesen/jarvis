import Foundation
#if canImport(os)
import os
#endif

/// The kinds of cached data and how long each stays fresh. Within the window no request is made; after it the cached
/// value is shown and refreshed in the background.
public enum JarvisRepositoryKind: String, CaseIterable, Sendable {
    case notes, tasks, calendar, factory, usage, status, proactive, health, settings, notifications

    public var freshness: Duration {
        switch self {
        case .calendar: .seconds(120)
        case .notes, .tasks: .seconds(300)
        case .factory: .seconds(60)
        case .usage: .seconds(120)
        case .status: .seconds(60)
        case .proactive: .seconds(120)
        case .health: .seconds(300)
        case .settings: .seconds(600)
        case .notifications: .seconds(30)
        }
    }

    /// The storage key for one kind and an optional scope (a project, a period, a folder).
    public func key(scope: String = "") -> String {
        scope.isEmpty ? rawValue : "\(rawValue):\(scope)"
    }
}

/// What a fetch returned: a new value (with the server validator, if any) or "not modified" for a conditional request.
public enum JarvisFetchResult<Value: Sendable>: Sendable {
    case modified(Value, validator: String?)
    case notModified
}

/// One state a screen sees while a repository loads. `failed` keeps the last cached value so the screen stays
/// useful, and carries the error so the failure is visible rather than an empty state.
public enum JarvisRepositoryUpdate<Value: Sendable>: Sendable {
    case cached(Value, isStale: Bool)
    case refreshing
    case fresh(Value)
    case failed(any Error, cached: Value?)
}

/// The outcome of `JarvisRepository.resolve`: the best value available and, when the refresh failed, why.
public struct JarvisResolved<Value: Sendable>: Sendable {
    public let value: Value?
    public let error: (any Error)?

    public init(value: Value?, error: (any Error)?) {
        self.value = value
        self.error = error
    }
}

/// Owns the per-account cache. Switching account or signing out removes everything stored for the previous account.
public actor JarvisCache {
    private let storage: any JarvisCacheStorage
    private let now: @Sendable () -> Date
    private var account: String?

    public init(storage: any JarvisCacheStorage, now: @escaping @Sendable () -> Date = { Date() }) {
        self.storage = storage
        self.now = now
    }

    public var currentAccount: String? { account }

    /// Binds the cache to the signed-in account. A different account clears all cached data first.
    public func bind(account newAccount: String) async {
        if let account, account != newAccount { await storage.removeAll() }
        account = newAccount
    }

    /// Sign-out: drop every cached entry and the account binding.
    public func clear() async {
        account = nil
        await storage.removeAll()
    }

    func read(_ key: String) async -> JarvisCacheEntry? {
        guard let account else { return nil }
        return await storage.read(account: account, key: key)
    }

    func write(data: Data, validator: String?, key: String) async {
        guard let account else { return }
        await storage.write(JarvisCacheEntry(data: data, fetchedAt: now(), validator: validator), account: account, key: key)
    }

    func touch(_ entry: JarvisCacheEntry, key: String) async {
        guard let account else { return }
        await storage.write(JarvisCacheEntry(data: entry.data, fetchedAt: now(), validator: entry.validator), account: account, key: key)
    }

    /// Drops one entry after a write that changed it, so the next open fetches instead of showing the old list.
    public func invalidate(kind: JarvisRepositoryKind, scope: String = "") async {
        await invalidate(kind.key(scope: scope))
    }

    /// Drops every scope of one kind (for example all note folders after a note was saved).
    public func invalidateAll(kind: JarvisRepositoryKind) async {
        guard let account else { return }
        await storage.remove(account: account, keyPrefix: kind.rawValue)
    }

    func invalidate(_ key: String) async {
        guard let account else { return }
        await storage.remove(account: account, key: key)
    }

    func age(of entry: JarvisCacheEntry) -> TimeInterval { now().timeIntervalSince(entry.fetchedAt) }
}

/// Stale-while-revalidate access to one data type. Views read from here, never from the network client.
public final class JarvisRepository<Value: Codable & Sendable & Equatable>: Sendable {
    public typealias Fetch = @Sendable (_ validator: String?) async throws -> JarvisFetchResult<Value>

    private let cache: JarvisCache
    private let key: String
    private let freshness: TimeInterval
    private let fetch: Fetch

    public init(cache: JarvisCache, kind: JarvisRepositoryKind, scope: String = "", fetch: @escaping Fetch) {
        self.cache = cache
        self.key = kind.key(scope: scope)
        let parts = kind.freshness.components
        self.freshness = Double(parts.seconds) + Double(parts.attoseconds) / 1e18
        self.fetch = fetch
    }

    /// Updates for one page open. Fresh cache: one `cached` update and no request. Stale cache: `cached`, then a quiet
    /// refresh. No cache: `refreshing`, then `fresh` or `failed`. `force` (pull to refresh) always refreshes.
    public func updates(force: Bool = false) -> AsyncStream<JarvisRepositoryUpdate<Value>> {
        AsyncStream { continuation in
            let task = Task {
                await run(force: force, continuation: continuation)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// The cached value without any request, for instant first paint.
    public func cachedValue() async -> Value? {
        guard let entry = await cache.read(key) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: entry.data)
    }

    /// One-shot access for loaders that assemble several reads into a single screen. `cacheOnly` returns the cached
    /// value without any request (instant first paint). Otherwise the call waits for the refresh and keeps the cached
    /// value when it fails, reporting the failure beside it.
    public func resolve(cacheOnly: Bool = false, force: Bool = false) async -> JarvisResolved<Value> {
        if cacheOnly { return JarvisResolved(value: await cachedValue(), error: nil) }
        var value: Value?
        var error: (any Error)?
        for await update in updates(force: force) {
            switch update {
            case .cached(let cached, _):
                value = cached
            case .fresh(let fresh):
                value = fresh
                error = nil
            case .refreshing:
                break
            case .failed(let failure, let cached):
                value = cached ?? value
                error = failure
            }
        }
        return JarvisResolved(value: value, error: error)
    }

    /// Marks the entry out of date (foreground, push notification) while keeping it for display.
    public func invalidate() async {
        await cache.invalidate(key)
    }

    private func run(force: Bool, continuation: AsyncStream<JarvisRepositoryUpdate<Value>>.Continuation) async {
        let signpost = JarvisSignpost.begin("open", key)
        defer { JarvisSignpost.end("open", signpost) }
        let entry = await cache.read(key)
        let value = entry.flatMap { try? JSONDecoder().decode(Value.self, from: $0.data) }
        var isFresh = false
        if let entry, value != nil { isFresh = await cache.age(of: entry) < freshness }
        if let value {
            continuation.yield(.cached(value, isStale: !isFresh || force))
            if isFresh && !force { return }
        } else {
            continuation.yield(.refreshing)
        }
        let refresh = JarvisSignpost.begin("refresh", key)
        defer { JarvisSignpost.end("refresh", refresh) }
        do {
            let result = try await fetch(value == nil ? nil : entry?.validator)
            if Task.isCancelled { return }
            switch result {
            case .modified(let fresh, let validator):
                if let data = try? JSONEncoder().encode(fresh) {
                    await cache.write(data: data, validator: validator, key: key)
                }
                continuation.yield(.fresh(fresh))
            case .notModified:
                if let entry, let value {
                    await cache.touch(entry, key: key)
                    continuation.yield(.fresh(value))
                } else {
                    continuation.yield(.failed(JarvisClientError.networkFailure, cached: nil))
                }
            }
        } catch {
            if Task.isCancelled { return }
            continuation.yield(.failed(error, cached: value))
        }
    }
}

/// Lightweight timing around page opens and repository refreshes, visible in Instruments.
/// API: OSSignposter (os).
enum JarvisSignpost {
    #if canImport(os)
    private static let signposter = OSSignposter(subsystem: "dk.jarvis.app", category: "repository")
    typealias State = OSSignpostIntervalState
    static func begin(_ name: StaticString, _ key: String) -> State {
        signposter.beginInterval(name, id: signposter.makeSignpostID(), "\(key, privacy: .public)")
    }
    static func end(_ name: StaticString, _ state: State) {
        signposter.endInterval(name, state)
    }
    #else
    typealias State = Void
    static func begin(_ name: StaticString, _ key: String) {}
    static func end(_ name: StaticString, _ state: State) {}
    #endif
}

/// What one card or list section shows while its repository loads. A failed refresh keeps the last value, so cached
/// data stays on screen and the failure is shown beside it instead of replacing it.
public enum JarvisCardState<Value: Sendable>: Sendable {
    case loading
    case loaded(Value, refreshFailed: Bool)
    case failed(any Error)

    public var value: Value? {
        if case .loaded(let value, _) = self { return value }
        return nil
    }

    public var refreshFailed: Bool {
        if case .loaded(_, let failed) = self { return failed }
        return false
    }

    public var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    public mutating func apply(_ update: JarvisRepositoryUpdate<Value>) {
        switch update {
        case .cached(let value, _), .fresh(let value):
            self = .loaded(value, refreshFailed: false)
        case .refreshing:
            if case .loaded = self {} else { self = .loading }
        case .failed(let error, let cached):
            if let cached {
                self = .loaded(cached, refreshFailed: true)
            } else if let value {
                self = .loaded(value, refreshFailed: true)
            } else {
                self = .failed(error)
            }
        }
    }
}
