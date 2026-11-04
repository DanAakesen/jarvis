import Foundation

/// One stored cache entry: the encoded value, when it was fetched and the validator (ETag) the server sent.
public struct JarvisCacheEntry: Codable, Equatable, Sendable {
    public let data: Data
    public let fetchedAt: Date
    public let validator: String?

    public init(data: Data, fetchedAt: Date, validator: String?) {
        self.data = data
        self.fetchedAt = fetchedAt
        self.validator = validator
    }
}

/// Where cache entries live. Implementations hold only non-secret, per-account data; tokens stay in the Keychain.
public protocol JarvisCacheStorage: Sendable {
    func read(account: String, key: String) async -> JarvisCacheEntry?
    func write(_ entry: JarvisCacheEntry, account: String, key: String) async
    func remove(account: String, key: String) async
    /// Removes every entry of the account whose key starts with `prefix` (all scopes of one kind).
    func remove(account: String, keyPrefix: String) async
    /// Removes the entries of every account.
    func removeAll() async
}

public actor JarvisInMemoryCacheStorage: JarvisCacheStorage {
    private var entries: [String: JarvisCacheEntry] = [:]

    public init() {}

    private func slot(_ account: String, _ key: String) -> String { "\(account)\u{0}\(key)" }

    public func read(account: String, key: String) -> JarvisCacheEntry? { entries[slot(account, key)] }

    public func write(_ entry: JarvisCacheEntry, account: String, key: String) {
        entries[slot(account, key)] = entry
    }

    public func remove(account: String, key: String) { entries[slot(account, key)] = nil }

    public func remove(account: String, keyPrefix: String) {
        let prefix = slot(account, keyPrefix)
        entries = entries.filter { !$0.key.hasPrefix(prefix) }
    }

    public func removeAll() { entries.removeAll() }
}

/// Files under the Caches directory (excluded from backup, purgeable by the system). One folder per account, one
/// file per key; names are hex-encoded so a key can never escape the folder.
/// API: FileManager.url(for: .cachesDirectory), URLResourceValues.isExcludedFromBackup.
public actor JarvisFileCacheStorage: JarvisCacheStorage {
    private let root: URL

    public init(root: URL) {
        self.root = root
    }

    public static func defaultRoot() -> URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("JarvisRepositoryCache", isDirectory: true)
    }

    private static func name(_ value: String) -> String {
        value.utf8.map { String(format: "%02x", $0) }.joined()
    }

    private func folder(_ account: String) -> URL {
        root.appendingPathComponent(Self.name(account), isDirectory: true)
    }

    private func file(_ account: String, _ key: String) -> URL {
        folder(account).appendingPathComponent(Self.name(key)).appendingPathExtension("json")
    }

    public func read(account: String, key: String) -> JarvisCacheEntry? {
        guard let data = try? Data(contentsOf: file(account, key)) else { return nil }
        return try? JSONDecoder().decode(JarvisCacheEntry.self, from: data)
    }

    public func write(_ entry: JarvisCacheEntry, account: String, key: String) {
        let directory = folder(account)
        guard let data = try? JSONEncoder().encode(entry) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var url = file(account, key)
        try? data.write(to: url, options: .atomic)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    public func remove(account: String, key: String) {
        try? FileManager.default.removeItem(at: file(account, key))
    }

    public func remove(account: String, keyPrefix: String) {
        let prefix = Self.name(keyPrefix)
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder(account), includingPropertiesForKeys: nil)) ?? []
        for url in urls where url.lastPathComponent.hasPrefix(prefix) {
            try? FileManager.default.removeItem(at: url)
        }
    }

    public func removeAll() {
        try? FileManager.default.removeItem(at: root)
    }
}
