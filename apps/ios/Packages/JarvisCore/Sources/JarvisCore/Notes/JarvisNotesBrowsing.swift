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
        guard let originalSession = session(),
              let entry = await read("recentlyOpenedNotes"), isCurrent(originalSession),
              let visits = try? JSONDecoder().decode([JarvisNoteVisit].self, from: entry.data) else { return [] }
        return Array(visits.filter { JarvisNotesLogic.validNotePath($0.path) }.prefix(50))
    }

    public func recordNoteOpen(path: String, at date: Date = Date()) async {
        guard JarvisNotesLogic.validNotePath(path), date.timeIntervalSince1970.isFinite,
              let originalSession = session() else { return }
        var visits = await recentNoteVisits().filter { $0.path != path }
        guard isCurrent(originalSession) else { return }
        visits.append(JarvisNoteVisit(path: path, openedAt: date))
        visits.sort { $0.openedAt > $1.openedAt }
        guard let data = try? JSONEncoder().encode(Array(visits.prefix(50))) else { return }
        await write(data: data, validator: nil, key: "recentlyOpenedNotes", session: originalSession)
    }
}


extension JarvisCache {
    /// Pins are local preferences scoped to the signed-in account, independent of note refreshes.
    public func pinnedNotePaths() async -> [String] {
        guard let originalSession = session(),
              let entry = await read("pinnedNotePaths"), isCurrent(originalSession),
              let paths = try? JSONDecoder().decode([String].self, from: entry.data) else { return [] }
        var seen = Set<String>()
        return paths.filter { JarvisNotesLogic.validNotePath($0) && seen.insert($0).inserted }
    }

    public func setNotePinned(path: String, pinned: Bool) async {
        guard JarvisNotesLogic.validNotePath(path), let originalSession = session() else { return }
        var paths = await pinnedNotePaths().filter { $0 != path }
        guard isCurrent(originalSession) else { return }
        if pinned { paths.insert(path, at: 0) }
        guard let data = try? JSONEncoder().encode(paths) else { return }
        await write(data: data, validator: nil, key: "pinnedNotePaths", session: originalSession)
    }
}


/// A stable, complete library projection. The view renders these rows lazily.
public struct JarvisNoteLibraryGroup: Identifiable, Equatable, Sendable {
    public enum Period: String, CaseIterable, Sendable {
        case today, yesterday, earlier
    }

    public let period: Period
    public let notes: [KnowledgeGraphNode]
    public var id: Period { period }
}

extension JarvisNotesPresentation {
    /// Parse each distinct timestamp once, then sort dates rather than constructing
    /// ISO8601 formatters in a SwiftUI body/sort comparator. No note-count cap.
    public static func libraryGroups(
        nodes: [KnowledgeGraphNode],
        visits: [JarvisNoteVisit],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [JarvisNoteLibraryGroup] {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        let opened = Dictionary(visits.map { ($0.path, $0.openedAt) }, uniquingKeysWith: max)
        var parsed: [String: Date] = [:]
        var dated: [(node: KnowledgeGraphNode, date: Date)] = []
        dated.reserveCapacity(nodes.count)
        for node in nodes {
            if Task.isCancelled { return [] }
            let modified: Date
            if let cached = parsed[node.updatedAt] {
                modified = cached
            } else {
                modified = fractional.date(from: node.updatedAt)
                    ?? standard.date(from: node.updatedAt) ?? .distantPast
                parsed[node.updatedAt] = modified
            }
            dated.append((node, max(opened[node.path] ?? .distantPast, modified)))
        }
        dated.sort { $0.date == $1.date ? $0.node.path < $1.node.path : $0.date > $1.date }
        let yesterday = calendar.date(byAdding: .day, value: -1, to: now)
        var buckets: [JarvisNoteLibraryGroup.Period: [KnowledgeGraphNode]] = [:]
        for entry in dated {
            let period: JarvisNoteLibraryGroup.Period
            if calendar.isDate(entry.date, inSameDayAs: now) {
                period = .today
            } else if let yesterday, calendar.isDate(entry.date, inSameDayAs: yesterday) {
                period = .yesterday
            } else {
                period = .earlier
            }
            buckets[period, default: []].append(entry.node)
        }
        return JarvisNoteLibraryGroup.Period.allCases.compactMap { period in
            guard let notes = buckets[period], !notes.isEmpty else { return nil }
            return JarvisNoteLibraryGroup(period: period, notes: notes)
        }
    }
}
