import Foundation

public enum JarvisNoteSort: String, CaseIterable, Sendable {
    /// Folders follow the owner's manual order; notes in a folder are listed by title.
    case updated, title, manual
}

public enum JarvisTaskSort: String, CaseIterable, Sendable {
    case due, priority
}

public enum JarvisTaskScopeFilter: String, CaseIterable, Sendable {
    case all, work, personal
}

public struct JarvisTaskSection: Equatable, Sendable, Identifiable {
    public enum Kind: String, Sendable {
        case pinned, overdue, today, upcoming, noDate, high, medium, normal
    }

    public let kind: Kind
    public let tasks: [VaultTask]
    public var id: String { kind.rawValue }
}

extension JarvisNotesPresentation {
    /// Display order only. Sorting never touches a file.
    public static func sorted(_ notes: [VaultNoteSummary], by sort: JarvisNoteSort) -> [VaultNoteSummary] {
        switch sort {
        case .updated:
            return notes.sorted {
                $0.updatedAt == $1.updatedAt
                    ? $0.title.localizedStandardCompare($1.title) == .orderedAscending
                    : $0.updatedAt > $1.updatedAt
            }
        case .title, .manual:
            return notes.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        }
    }
}

extension JarvisNotesPresentation {
    /// The graph limited to a folder and its subfolders. Edges are kept only when both ends remain.
    public static func graph(_ source: KnowledgeGraph, in folder: String) -> KnowledgeGraph {
        guard !folder.isEmpty else { return source }
        let nodes = source.nodes.filter { $0.directory == folder || $0.directory.hasPrefix(folder + "/") }
        let ids = Set(nodes.map(\.id))
        return KnowledgeGraph(
            nodes: nodes, edges: source.edges.filter { ids.contains($0.source) && ids.contains($0.target) },
            updatedAt: source.updatedAt, openTaskNoteCount: source.openTaskNoteCount,
            taskCountsPartial: source.taskCountsPartial
        )
    }
}

/// Manual order of pins and folders is display metadata; it never moves a file.
public enum JarvisManualOrder {
    public static func moved(_ items: [String], _ item: String, by offset: Int) -> [String] {
        guard let index = items.firstIndex(of: item) else { return items }
        let target = min(max(index + offset, 0), items.count - 1)
        guard target != index else { return items }
        var result = items
        result.remove(at: index)
        result.insert(item, at: target)
        return result
    }

    /// The semantics of SwiftUI's `onMove`: `destination` is an index in the original array.
    public static func moved(_ items: [String], from source: IndexSet, to destination: Int) -> [String] {
        let valid = source.filter { items.indices.contains($0) }
        guard !valid.isEmpty else { return items }
        let moving = valid.sorted().map { items[$0] }
        var rest = items.enumerated().filter { !valid.contains($0.offset) }.map(\.element)
        let insertAt = min(max(destination - valid.filter { $0 < destination }.count, 0), rest.count)
        rest.insert(contentsOf: moving, at: insertAt)
        return rest
    }
}

public struct JarvisFolderPickerRow: Equatable, Sendable, Identifiable {
    public let path: String
    public let name: String
    public let depth: Int
    public let isExpandable: Bool
    public let isExpanded: Bool
    public var id: String { path }
}

/// The destination picker lists the vault root and every normal folder, nested ones included.
/// Expansion and selection are separate: the view toggles `expanded` and chooses `path` independently.
public enum JarvisFolderPicker {
    public static func rows(
        paths: [String], rootName: String, expanded: Set<String>, query: String = ""
    ) -> [JarvisFolderPickerRow] {
        let valid = Array(Set(paths.filter { !$0.isEmpty && JarvisNotesLogic.validFolder($0) }))
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !needle.isEmpty {
            // A search shows matching folders flat, with their full location, so nested matches are reachable.
            var all = Set<String>()
            for path in valid {
                var prefix = ""
                for segment in path.split(separator: "/") {
                    prefix = prefix.isEmpty ? String(segment) : "\(prefix)/\(segment)"
                    all.insert(prefix)
                }
            }
            return all
                .filter { $0.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
                .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
                .map {
                    JarvisFolderPickerRow(
                        path: $0, name: $0.replacingOccurrences(of: "/", with: " / "), depth: 0,
                        isExpandable: false, isExpanded: false
                    )
                }
        }
        var rows = [JarvisFolderPickerRow(path: "", name: rootName, depth: 0, isExpandable: false, isExpanded: true)]
        func append(_ nodes: [VaultFolderNode], depth: Int) {
            for node in nodes {
                let isOpen = expanded.contains(node.path)
                rows.append(JarvisFolderPickerRow(
                    path: node.path, name: node.name, depth: depth,
                    isExpandable: !node.children.isEmpty, isExpanded: isOpen
                ))
                if isOpen { append(node.children, depth: depth + 1) }
            }
        }
        append(JarvisNotesPresentation.folderTree(valid), depth: 1)
        return rows
    }
}

extension VaultTask {
    /// Pins follow the task's note and its exact line text (the version), not its line number, so deleting or
    /// inserting a line elsewhere never moves a pin onto a different task. Editing the task's words lapses its pin.
    public var pinKey: String { "\(path)#\(version)" }
}

extension JarvisNotesLogic {
    /// Sections for the Tasks page. Pinned tasks lead, in their pinned order, and are not repeated below.
    public static func taskSections(
        _ tasks: [VaultTask], today: String, sort: JarvisTaskSort,
        scope: JarvisTaskScopeFilter, pinned: [String]
    ) -> [JarvisTaskSection] {
        let open = tasks.filter { task in
            !task.done && (scope == .all || (scope == .work) == (task.scope == .work))
        }
        let byKey = Dictionary(open.map { ($0.pinKey, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        let pinnedTasks = pinned.compactMap { key -> VaultTask? in
            guard let task = byKey[key], seen.insert(key).inserted else { return nil }
            return task
        }
        let rest = open.filter { !seen.contains($0.pinKey) }
        var sections: [JarvisTaskSection] = []
        if !pinnedTasks.isEmpty { sections.append(JarvisTaskSection(kind: .pinned, tasks: pinnedTasks)) }
        switch sort {
        case .due:
            let groups = taskGroups(rest, today: today)
            sections += [
                JarvisTaskSection(kind: .overdue, tasks: groups.overdue),
                JarvisTaskSection(kind: .today, tasks: groups.today),
                JarvisTaskSection(kind: .upcoming, tasks: groups.upcoming),
                JarvisTaskSection(kind: .noDate, tasks: groups.noDate),
            ]
        case .priority:
            let ordered = taskGroups(rest, today: today)
            let flat = ordered.overdue + ordered.today + ordered.upcoming + ordered.noDate
            sections += [
                JarvisTaskSection(kind: .high, tasks: flat.filter { $0.priority == .high }),
                JarvisTaskSection(kind: .medium, tasks: flat.filter { $0.priority == .medium }),
                JarvisTaskSection(kind: .normal, tasks: flat.filter { $0.priority == .normal }),
            ]
        }
        return sections.filter { !$0.tasks.isEmpty }
    }
}
