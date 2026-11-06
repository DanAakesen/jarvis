import Foundation

extension JarvisNotesPresentation {
    /// Direct child folders come from the complete inventory, including implicit ancestors and empty-note folders.
    public static func childFolders(in directory: String, paths: [String]) -> [VaultFolderNode] {
        guard JarvisNotesLogic.validFolder(directory) else { return [] }
        var children = folderTree(paths.filter(JarvisNotesLogic.validFolder))
        var prefix = ""
        for segment in directory.split(separator: "/") {
            prefix = prefix.isEmpty ? String(segment) : "\(prefix)/\(segment)"
            guard let folder = children.first(where: { $0.path == prefix }) else { return [] }
            children = folder.children
        }
        return children
    }

    public static func parentFolder(of directory: String) -> String? {
        guard !directory.isEmpty, JarvisNotesLogic.validFolder(directory) else { return nil }
        return directory.split(separator: "/").dropLast().joined(separator: "/")
    }

    /// A new name is one child of the current location, never an alternative absolute path.
    public static func newFolderPath(named name: String, in parent: String) -> String? {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
        guard !clean.isEmpty, !clean.contains("/"), JarvisNotesLogic.validFolder(parent) else { return nil }
        let path = parent.isEmpty ? clean : "\(parent)/\(clean)"
        return JarvisNotesLogic.validFolder(path) ? path : nil
    }

    /// Both the directory count and its rows use this same collection; descendants do not inflate the count.
    public static func directoryNotes(_ notes: [VaultNoteSummary], in directory: String) -> [VaultNoteSummary] {
        notes.filter { $0.directory == directory }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    public static func recentlyOpenedNotes(_ graph: KnowledgeGraph, visits: [JarvisNoteVisit], limit: Int = 5) -> [KnowledgeGraphNode] {
        let nodes = Dictionary(graph.nodes.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        return Array(visits.sorted { $0.openedAt > $1.openedAt }.compactMap { visit in
            guard seen.insert(visit.path).inserted else { return nil }
            return nodes[visit.path]
        }.prefix(max(0, limit)))
    }
}

public struct JarvisNoteVisit: Codable, Equatable, Sendable {
    public let path: String
    public let openedAt: Date

    public init(path: String, openedAt: Date) {
        self.path = path
        self.openedAt = openedAt
    }
}

extension JarvisCache {
    /// Shares the account-bound cache, but note refresh invalidation must not erase reading history.
    public func recentNoteVisits() async -> [JarvisNoteVisit] {
        guard let entry = await read("recentlyOpenedNotes"),
              let visits = try? JSONDecoder().decode([JarvisNoteVisit].self, from: entry.data) else { return [] }
        return Array(visits.filter { JarvisNotesLogic.validNotePath($0.path) }.prefix(50))
    }

    public func recordNoteOpen(path: String, at date: Date = Date()) async {
        guard JarvisNotesLogic.validNotePath(path), date.timeIntervalSince1970.isFinite,
              let originalAccount = currentAccount else { return }
        var visits = await recentNoteVisits().filter { $0.path != path }
        guard currentAccount == originalAccount else { return }
        visits.append(JarvisNoteVisit(path: path, openedAt: date))
        visits.sort { $0.openedAt > $1.openedAt }
        guard let data = try? JSONEncoder().encode(Array(visits.prefix(50))) else { return }
        await write(data: data, validator: nil, key: "recentlyOpenedNotes")
    }
}
