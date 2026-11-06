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
    /// Compact source context, excluding generic collection names already implied by the task list.
    /// Stored headings/paths remain unchanged and are still available in task details.
    public static func taskSourceLabel(heading: String?, path: String) -> String? {
        let generic: Set<String> = [
            "task", "tasks", "todo", "todos", "to-do", "to-dos", "opgave", "opgaver", "gøremål",
            "action", "actions", "action items", "handling", "handlinger", "handlingspunkter",
            ".", "..",
            "work", "personal", "arbejde", "privat", "notes", "noter", "projects", "projekter"
        ]
        let note = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        let components = path.split(separator: "/").map(String.init)
        // Vault task paths are Work/Personal notes or root task files. Never turn
        // an enclosing vault/root folder into invented project context.
        let scoped = components.first.map { ["work", "personal"].contains($0.lowercased()) } ?? false
        let folders = scoped ? Array(components.dropFirst().dropLast().reversed()) : []
        return ([heading, note].compactMap { $0 } + folders)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty && !generic.contains($0.lowercased()) }
    }

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
