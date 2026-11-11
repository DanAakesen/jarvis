import Foundation

public struct WatchSnapshotStore {
    public enum Kind: String {
        case health, dashboard

        var key: String { "watch.\(rawValue)" }
        var fileName: String { "watch-\(rawValue).json" }
    }

    private let directory: URL
    private let defaults: UserDefaults?

    public init(directory: URL, defaults: UserDefaults? = nil) {
        self.directory = directory
        self.defaults = defaults
    }

    #if canImport(Darwin)
    public static func appGroup() -> Self? {
        let identifier = "group.com.danaakesen.jarvis"
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
            .map { Self(directory: $0, defaults: UserDefaults(suiteName: identifier)) }
    }
    #endif

    public func load(_ kind: Kind) -> Data? {
        let url = directory.appendingPathComponent(kind.fileName)
        if FileManager.default.fileExists(atPath: url.path) {
            return try? Data(contentsOf: url)
        }
        return defaults?.data(forKey: kind.key)
    }

    public func save(_ data: Data, kind: Kind) throws {
        let url = directory.appendingPathComponent(kind.fileName)
        #if canImport(Darwin)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
        defaults?.removeObject(forKey: kind.key)
    }

    public func clear() {
        for kind in [Kind.health, .dashboard] {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(kind.fileName))
            defaults?.removeObject(forKey: kind.key)
        }
    }
}
