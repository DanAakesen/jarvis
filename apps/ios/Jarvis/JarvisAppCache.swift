import Foundation
import JarvisCore

/// The app-wide on-device cache. Structured data lives as files under the Caches directory; tokens stay in the
/// Keychain. The cache belongs to the one signed-in owner and is cleared on sign-out and on every new sign-in.
/// API: FileManager cachesDirectory, ScenePhase (foreground invalidation) in the callers.
enum JarvisAppCache {
    static let shared = JarvisCache(storage: JarvisFileCacheStorage(root: JarvisFileCacheStorage.defaultRoot()))
    private static let owner = "owner"

    /// Binds the cache to the signed-in owner before the first read or write.
    static func bindIfNeeded() async {
        if await shared.currentAccount == nil { await shared.bind(account: owner) }
    }

    /// Sign-out and account change: remove every cached entry.
    static func clear() async {
        await shared.clear()
    }
}
