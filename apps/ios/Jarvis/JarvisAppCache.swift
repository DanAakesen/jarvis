import Foundation
import JarvisCore

/// The app-wide on-device cache. Structured data lives as files under the Caches directory; tokens stay in the
/// Keychain. The cache belongs to the one signed-in owner and is cleared on sign-out and on every new sign-in.
/// API: FileManager cachesDirectory, ScenePhase (foreground invalidation) in the callers.
enum JarvisAppCache {
    static let shared: JarvisCache = {
        #if DEBUG
        // Deterministic UI fixtures must not inherit cached responses from another test's process.
        if ProcessInfo.processInfo.arguments.contains("--ui-test-navigation") {
            return JarvisCache(storage: JarvisInMemoryCacheStorage())
        }
        #endif
        return JarvisCache(storage: JarvisFileCacheStorage(root: JarvisFileCacheStorage.defaultRoot()))
    }()
    private static let owner = "owner"

    /// Binds the cache to the signed-in owner before the first read or write.
    static func bindIfNeeded() async {
        if await shared.currentAccount == nil { await shared.bind(account: owner) }
    }

    /// Sign-out and account change: remove every cached entry.
    static func clear() async {
        await shared.clear()
    }

    /// A repository over the app cache for one kind of data. Pages read through it and never call the network
    /// client directly for cached lists.
    static func repository<Value: Codable & Sendable & Equatable>(
        _ kind: JarvisRepositoryKind,
        scope: String = "",
        fetch: @escaping JarvisRepository<Value>.Fetch
    ) async -> JarvisRepository<Value> {
        await bindIfNeeded()
        return JarvisRepository(cache: shared, kind: kind, scope: scope, fetch: fetch)
    }

    /// After a write that changed a cached list, drop that entry so the next open fetches it.
    static func invalidate(_ kind: JarvisRepositoryKind, scope: String = "") async {
        await bindIfNeeded()
        await shared.invalidate(kind: kind, scope: scope)
    }

    /// After a write that can change every scope of one kind (a saved note, a completed task).
    static func invalidateAll(_ kind: JarvisRepositoryKind) async {
        await bindIfNeeded()
        await shared.invalidateAll(kind: kind)
    }
}
