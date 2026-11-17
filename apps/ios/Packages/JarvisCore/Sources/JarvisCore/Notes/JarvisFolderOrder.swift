import Foundation

/// The owner's manual folder order, one list of child folder paths per parent folder (`""` is the vault root).
/// It is display metadata kept by the backend, so it follows the owner across devices. It never renames or moves a
/// file and never adds a number prefix. A folder missing from it (new, renamed or never ordered) sorts after the
/// ordered ones, in the order it came in; a listed folder that no longer exists is ignored.
public struct JarvisFolderOrder: Equatable, Sendable {
    public static let maximumFolders = 500

    public var byParent: [String: [String]]

    public init(byParent: [String: [String]] = [:]) {
        self.byParent = byParent
    }

    /// `folders` are the direct children of `parent`, in their default order.
    public func ordered(_ folders: [VaultFolderNode], in parent: String) -> [VaultFolderNode] {
        let rank = Dictionary(
            (byParent[parent] ?? []).enumerated().map { ($0.element, $0.offset) },
            uniquingKeysWith: { first, _ in first }
        )
        let known = folders.filter { rank[$0.path] != nil }.sorted { rank[$0.path]! < rank[$1.path]! }
        return known + folders.filter { rank[$0.path] == nil }
    }

    public mutating func set(_ paths: [String], in parent: String) {
        if paths.isEmpty { byParent[parent] = nil } else { byParent[parent] = paths }
    }

    /// Whether `paths` is a storable order for `parent`: unique, valid, direct children only, and not too many.
    public static func isValid(_ paths: [String], in parent: String) -> Bool {
        guard JarvisNotesLogic.validFolder(parent), paths.count <= maximumFolders else { return false }
        let prefix = parent.isEmpty ? "" : parent + "/"
        var seen = Set<String>()
        return paths.allSatisfy {
            !$0.isEmpty && JarvisNotesLogic.validFolder($0) && $0.hasPrefix(prefix) &&
                !$0.dropFirst(prefix.count).contains("/") && seen.insert($0).inserted
        }
    }
}

struct JarvisFolderOrderResponse: Decodable {
    struct Entry: Decodable {
        let parent: String
        let folders: [String]
    }

    let orders: [Entry]
}

struct JarvisFolderOrderRequest: Encodable {
    let parent: String
    let folders: [String]
}
