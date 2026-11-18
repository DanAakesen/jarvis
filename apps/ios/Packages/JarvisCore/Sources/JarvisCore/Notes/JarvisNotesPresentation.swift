import Foundation

public struct VaultFolderNode: Equatable, Sendable, Identifiable {
    public let path: String
    public let name: String
    public let children: [VaultFolderNode]

    public var id: String { path }
}

public enum JarvisNotesPresentation {
    /// The most recently modified notes, newest first. Nodes whose date cannot be read sort last.
    public static func recentNotes(_ nodes: [KnowledgeGraphNode], limit: Int = 5) -> [KnowledgeGraphNode] {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions.insert(.withFractionalSeconds)
        let plain = ISO8601DateFormatter()
        func date(_ node: KnowledgeGraphNode) -> Date {
            fractional.date(from: node.updatedAt) ?? plain.date(from: node.updatedAt) ?? .distantPast
        }
        return Array(nodes.sorted {
            let (a, b) = (date($0), date($1))
            return a == b ? $0.path < $1.path : a > b
        }.prefix(max(0, limit)))
    }

    public static func folderTree(_ paths: [String]) -> [VaultFolderNode] {
        var roots: [VaultFolderNode] = []
        for path in Set(paths).sorted() {
            let segments = path.split(separator: "/")
            guard !segments.isEmpty else { continue }
            insert(Array(segments), prefix: "", into: &roots)
        }
        return roots
    }

    private static func insert(
        _ segments: [Substring],
        prefix: String,
        into folders: inout [VaultFolderNode]
    ) {
        guard let first = segments.first else { return }
        let path = prefix.isEmpty ? String(first) : "\(prefix)/\(first)"
        let index: Int
        if let found = folders.firstIndex(where: { $0.path == path }) {
            index = found
        } else {
            folders.append(VaultFolderNode(path: path, name: String(first), children: []))
            folders.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            index = folders.firstIndex(where: { $0.path == path })!
        }
        guard segments.count > 1 else { return }
        var folder = folders[index]
        var children = folder.children
        insert(Array(segments.dropFirst()), prefix: path, into: &children)
        folder = VaultFolderNode(path: folder.path, name: folder.name, children: children)
        folders[index] = folder
    }
}

public struct JarvisNotesFolderShare: Equatable, Sendable, Identifiable {
    public let folder: String
    public let count: Int
    public var id: String { folder }
}

extension JarvisNotesPresentation {
    /// Notes per top-level folder, largest first, for the overview colour bar and its legend. Root notes use "".
    public static func folderShares(_ graph: KnowledgeGraph) -> [JarvisNotesFolderShare] {
        Dictionary(grouping: graph.nodes, by: \.folder)
            .map { JarvisNotesFolderShare(folder: $0.key, count: $0.value.count) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.folder.localizedStandardCompare($1.folder) == .orderedAscending }
    }

    /// The most recently updated notes, newest first, for the Recent strip.
    public static func recentNotes(_ graph: KnowledgeGraph, limit: Int = 5) -> [KnowledgeGraphNode] {
        Array(graph.nodes.sorted { $0.updatedAt > $1.updatedAt }.prefix(max(0, limit)))
    }
}
