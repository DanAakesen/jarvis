import Foundation

/// A note split for the editor: everything before the title line (frontmatter and blank lines), the title,
/// and the body. Joining the parts returns the original text byte for byte, so properties survive an edit.
public struct JarvisNoteParts: Equatable, Sendable {
    public var head: String
    public var title: String?
    public var titleEnding: String
    public var body: String

    public init(_ content: String) {
        let document = JarvisNoteDocument(content)
        let blocks = document.blocks
        let index = blocks.firstIndex { !$0.isCode && $0.headingLevel == 1 }
        if let index, blocks[..<index].allSatisfy({ $0.prefix.isEmpty && $0.text.trimmingCharacters(in: .whitespaces).isEmpty }) {
            head = document.metadata + blocks[..<index].map(\.markdown).joined()
            title = blocks[index].text
            titleEnding = blocks[index].ending
            body = blocks[(index + 1)...].map(\.markdown).joined()
        } else {
            head = document.metadata
            title = nil
            titleEnding = ""
            body = blocks.map(\.markdown).joined()
        }
    }

    /// A new note: the title becomes the first heading so the note has a real title, not only a file name.
    public init(newTitle: String, body: String) {
        head = ""
        title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        titleEnding = "\n\n"
        self.body = body
    }

    public var content: String {
        head + (title.map { "# " + $0 + titleEnding } ?? "") + body
    }

    /// The text the reader shows under the title and provenance: no properties and no repeated title.
    public var readableBody: String { body }
}

public enum JarvisNoteTitle {
    /// The title shown when a note has no heading: its file name, read as words.
    public static func fileTitle(path: String) -> String {
        let name = (path.split(separator: "/").last.map(String.init) ?? path)
        let stem = name.lowercased().hasSuffix(".md") ? String(name.dropLast(3)) : name
        let words = stem.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    public static func title(content: String, path: String) -> String {
        let title = JarvisNoteParts(content).title?.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.flatMap { $0.isEmpty ? nil : $0 } ?? fileTitle(path: path)
    }

    /// Compact provenance such as "Personal / Home"; empty for a note at the vault root.
    public static func location(path: String) -> String {
        path.split(separator: "/").dropLast().joined(separator: " / ")
    }
}

public struct JarvisNoteConnections: Equatable, Sendable {
    public let outgoing: [KnowledgeGraphNode]
    public let incoming: [KnowledgeGraphNode]
}

/// Internal links as the vault resolves them: `[[Target]]`, `[[Target|Alias]]` and relative Markdown links.
public enum JarvisNoteLinks {
    public static let scheme = "jarvis-note"

    /// Real links only, from the graph the backend built. Nothing is inferred from text here.
    public static func connections(of path: String, in graph: KnowledgeGraph) -> JarvisNoteConnections {
        guard let node = graph.nodes.first(where: { $0.path == path }) else {
            return JarvisNoteConnections(outgoing: [], incoming: [])
        }
        let byID = Dictionary(graph.nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        func nodes(_ ids: [String]) -> [KnowledgeGraphNode] {
            var seen = Set<String>()
            return ids.compactMap { byID[$0] }.filter { seen.insert($0.id).inserted }
                .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        }
        let links = graph.edges.filter { $0.type == .link }
        return JarvisNoteConnections(
            outgoing: nodes(links.filter { $0.source == node.id }.map(\.target)),
            incoming: nodes(links.filter { $0.target == node.id }.map(\.source))
        )
    }

    /// Resolves a link target the way the vault does: relative to the note, from the root, or by unique file name.
    public static func resolve(_ rawTarget: String, from sourcePath: String, paths: Set<String>) -> String? {
        var target = rawTarget.split(whereSeparator: { $0 == "|" || $0 == "#" || $0 == "?" }).first.map(String.init) ?? ""
        target = target.trimmingCharacters(in: .whitespaces)
        while target.hasPrefix("/") { target.removeFirst() }
        guard !target.isEmpty, !target.hasPrefix("//"), !target.contains("\\"),
              target.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#, options: .regularExpression) == nil else { return nil }
        if !target.lowercased().hasSuffix(".md") { target += ".md" }
        let directory = sourcePath.split(separator: "/").dropLast().map(String.init)
        var relative = directory
        for segment in target.split(separator: "/") {
            if segment == ".." { if relative.isEmpty { return nil }; relative.removeLast() }
            else if segment != "." { relative.append(String(segment)) }
        }
        for candidate in [target, relative.joined(separator: "/")] where paths.contains(candidate) {
            return candidate
        }
        if !target.contains("/") {
            let matches = paths.filter { ($0.split(separator: "/").last.map(String.init) ?? $0).lowercased() == target.lowercased() }
            if matches.count == 1 { return matches.first }
        }
        return nil
    }

    /// Rewrites internal links on one line to a private scheme the reader can intercept; external links are untouched.
    public static func rewriteInternalLinks(_ line: String) -> String {
        var result = line
        if let wiki = try? NSRegularExpression(pattern: #"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]"#) {
            let range = NSRange(result.startIndex..., in: result)
            let matches = wiki.matches(in: result, range: range).reversed()
            for match in matches {
                guard let whole = Range(match.range, in: result), let targetRange = Range(match.range(at: 1), in: result) else { continue }
                let target = String(result[targetRange])
                let label = Range(match.range(at: 2), in: result).map { String(result[$0]) } ?? target
                result.replaceSubrange(whole, with: "[\(label)](\(url(for: target)))")
            }
        }
        if let markdown = try? NSRegularExpression(pattern: #"\[([^\]]*)\]\(([^)\s]+)\)"#) {
            let range = NSRange(result.startIndex..., in: result)
            for match in markdown.matches(in: result, range: range).reversed() {
                guard let whole = Range(match.range, in: result),
                      let labelRange = Range(match.range(at: 1), in: result),
                      let targetRange = Range(match.range(at: 2), in: result) else { continue }
                let target = String(result[targetRange])
                guard !target.hasPrefix(scheme + ":"), !target.hasPrefix("#"),
                      target.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#, options: .regularExpression) == nil,
                      !target.hasPrefix("//") else { continue }
                let decoded = target.removingPercentEncoding ?? target
                result.replaceSubrange(whole, with: "[\(result[labelRange])](\(url(for: decoded)))")
            }
        }
        return result
    }

    public static func target(of url: URL) -> String? {
        guard url.scheme == scheme, url.path.count > 1 else { return nil }
        return String(url.path.dropFirst())
    }

    private static func url(for target: String) -> String {
        let encoded = target.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? target
        return "\(scheme):///\(encoded.replacingOccurrences(of: ")", with: "%29"))"
    }
}

public struct JarvisLineDiffRow: Equatable, Sendable, Identifiable {
    public enum Kind: Sendable { case same, added, removed }
    public let id: Int
    public let kind: Kind
    public let text: String
}

public enum JarvisLineDiff {
    /// Line differences from the latest saved version to the draft: `removed` lines would be lost if the draft is
    /// saved over it, `added` lines are the draft's own. Nil when the notes are too long to compare cheaply.
    public static func rows(latest: String, draft: String, maximumLines: Int = 1_200) -> [JarvisLineDiffRow]? {
        let old = latest.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let new = draft.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard old.count <= maximumLines, new.count <= maximumLines else { return nil }
        var table = Array(repeating: Array(repeating: 0, count: new.count + 1), count: old.count + 1)
        for i in stride(from: old.count - 1, through: 0, by: -1) {
            for j in stride(from: new.count - 1, through: 0, by: -1) {
                table[i][j] = old[i] == new[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
            }
        }
        var rows: [JarvisLineDiffRow] = []
        var i = 0, j = 0
        func add(_ kind: JarvisLineDiffRow.Kind, _ text: String) {
            rows.append(JarvisLineDiffRow(id: rows.count, kind: kind, text: text))
        }
        while i < old.count || j < new.count {
            if i < old.count, j < new.count, old[i] == new[j] {
                add(.same, old[i]); i += 1; j += 1
            } else if j < new.count, i == old.count || table[i][j + 1] > table[i + 1][j] {
                add(.added, new[j]); j += 1
            } else {
                add(.removed, old[i]); i += 1
            }
        }
        return rows
    }
}

/// What to do when a save did not finish cleanly. The draft is never replaced and never written over a newer
/// version without the owner choosing to.
public enum JarvisNoteSaveRecovery: Equatable, Sendable {
    case alreadySaved
    case writeAgain
    case conflict

    public static func decide(draft: String, baselineSha: String, latest: VaultNote) -> JarvisNoteSaveRecovery {
        if latest.content == draft { return .alreadySaved }
        return latest.sha == baselineSha ? .writeAgain : .conflict
    }
}

public enum JarvisNoteSaveFailure: Equatable, Sendable {
    case conflict, outcomeUnknown, notFound, signInRequired, other

    public static func classify(_ error: Error) -> JarvisNoteSaveFailure {
        if let error = error as? JarvisNotesClientError {
            switch error {
            case .noteConflict: return .conflict
            case .writeOutcomeUnknown: return .outcomeUnknown
            case .noteNotFound: return .notFound
            default: return .other
            }
        }
        if let error = error as? JarvisClientError {
            switch error {
            case .signInRequired, .notOwner: return .signInRequired
            case .networkFailure, .timedOut, .serviceUnavailable: return .outcomeUnknown
            default: return .other
            }
        }
        return .other
    }
}
