import Foundation

public struct VaultFolderNode: Equatable, Sendable, Identifiable {
    public let path: String
    public let name: String
    public let children: [VaultFolderNode]

    public var id: String { path }
}

public struct NotesGraphPosition: Equatable, Sendable {
    public let x: Double
    public let y: Double
}

public enum JarvisNotesPresentation {
    public static func folderTree(_ paths: [String]) -> [VaultFolderNode] {
        var roots: [VaultFolderNode] = []
        for path in Set(paths).sorted() {
            let segments = path.split(separator: "/")
            guard !segments.isEmpty else { continue }
            insert(Array(segments), prefix: "", into: &roots)
        }
        return roots
    }

    public static func graphPositions(_ graph: KnowledgeGraph) -> [String: NotesGraphPosition] {
        let groups = Dictionary(grouping: graph.nodes.sorted { $0.id < $1.id }, by: \.folder)
        let folders = groups.keys.sorted()
        guard !folders.isEmpty else { return [:] }

        var positions: [String: NotesGraphPosition] = [:]
        for (folderIndex, folder) in folders.enumerated() {
            let nodes = groups[folder] ?? []
            let folderAngle = -Double.pi / 2 + Double(folderIndex) * 2 * Double.pi / Double(folders.count)
            let centerX = 0.5 + cos(folderAngle) * (folders.count == 1 ? 0 : 0.28)
            let centerY = 0.5 + sin(folderAngle) * (folders.count == 1 ? 0 : 0.28)
            for (index, node) in nodes.enumerated() {
                let angle = Double(index) * 2.399963229728653
                let radius = nodes.count <= 1 ? 0 : 0.18 * sqrt(Double(index + 1) / Double(nodes.count))
                positions[node.id] = NotesGraphPosition(
                    x: min(max(centerX + cos(angle) * radius, 0.04), 0.96),
                    y: min(max(centerY + sin(angle) * radius, 0.04), 0.96)
                )
            }
        }
        return positions
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
