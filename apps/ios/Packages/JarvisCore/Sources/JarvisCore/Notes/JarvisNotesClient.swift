import Foundation

public struct VaultNoteSummary: Codable, Equatable, Sendable, Identifiable {
    public let path: String
    public let title: String
    public let folder: String
    public let directory: String
    public let updatedAt: String

    public var id: String { path }
}

public struct VaultNotePage: Codable, Equatable, Sendable {
    public let notes: [VaultNoteSummary]
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
}

public struct VaultNoteTree: Codable, Equatable, Sendable {
    public let directories: [String]
    public let rootNoteCount: Int
    public let truncated: Bool
    public let updatedAt: String
}

public struct VaultNote: Codable, Equatable, Sendable, Identifiable {
    public let path: String
    public let content: String
    public let sha: String
    public let url: String

    public var id: String { path }
}

public struct VaultNoteWrite: Codable, Equatable, Sendable {
    public let path: String
    public let commit: String
    public let url: String
}

public enum JarvisNotesLanguage: String, Codable, Equatable, Sendable {
    case da
    case en
}

public enum VaultTaskState: String, Sendable {
    case open
    case done
    case all
}

public enum VaultTaskScope: String, Codable, Equatable, Sendable {
    case personal
    case work
}

public struct VaultTask: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let text: String
    public let done: Bool
    public let dueDate: String?
    public let dueTime: String?
    public let dueAt: String?
    public let priority: Priority
    public let path: String
    public let line: Int
    public let heading: String?
    public let version: String

    public enum Priority: String, Codable, Equatable, Sendable {
        case high
        case medium
        case normal
    }

    public var scope: VaultTaskScope {
        let root = path.split(separator: "/").first.map(String.init) ?? ""
        if root.caseInsensitiveCompare("Work") == .orderedSame { return .work }
        if root.caseInsensitiveCompare("Personal") == .orderedSame { return .personal }
        return heading?.range(of: #"^\s*work\b"#, options: [.regularExpression, .caseInsensitive]) == nil
            ? .personal : .work
    }
}

public struct VaultTaskList: Codable, Equatable, Sendable {
    public let items: [VaultTask]
    public let readAt: String
    public let today: String
    public let total: Int
    public let truncated: Bool
}

public struct VaultTaskWrite: Codable, Equatable, Sendable {
    public let id: String
    public let path: String
    public let line: Int
    public let done: Bool
    public let version: String
}

public struct KnowledgeGraphNode: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let path: String
    public let title: String
    public let folder: String
    public let directory: String
    public let updatedAt: String
    public let degree: Int
    public let openTaskCount: Int?
}

public struct KnowledgeGraphEdge: Codable, Equatable, Sendable {
    public let source: String
    public let target: String
    public let type: Kind
    public let score: Double?

    public enum Kind: String, Codable, Equatable, Sendable {
        case link
        case similar
    }
}

public struct KnowledgeGraph: Codable, Equatable, Sendable {
    public let nodes: [KnowledgeGraphNode]
    public let edges: [KnowledgeGraphEdge]
    public let updatedAt: String
    public let openTaskNoteCount: Int?
    public let taskCountsPartial: Bool?
}

public struct KnowledgeSearchHit: Codable, Equatable, Sendable {
    public let nodeId: String
    public let score: Double
    public let snippet: String
}

public struct KnowledgeGraphSearch: Equatable, Sendable {
    public let graph: KnowledgeGraph
    public let hits: [KnowledgeSearchHit]
}

public enum JarvisNotesClientError: Error, Equatable, Sendable {
    case invalidRequest
    case invalidResponse
    case noteNotFound
    case noteConflict(currentSha: String?, content: String?)
    case taskConflict
    case writeOutcomeUnknown
}

public struct VaultTaskGroups: Equatable, Sendable {
    public let overdue: [VaultTask]
    public let today: [VaultTask]
    public let upcoming: [VaultTask]
    public let noDate: [VaultTask]
}

public enum JarvisNotesLogic {
    public static let maximumNoteBytes = 256 * 1024

    public static func notePath(folder: String, title: String) -> String? {
        guard validFolder(folder), !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let decomposed = title.precomposedStringWithCanonicalMapping
            .decomposedStringWithCanonicalMapping
        let slug = String(decomposed.unicodeScalars.filter {
            !CharacterSet.nonBaseCharacters.contains($0)
        }).lowercased()
            .split(whereSeparator: { !$0.isASCII || !$0.isLetter && !$0.isNumber })
            .joined(separator: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        guard !slug.isEmpty else { return nil }
        let path = folder.isEmpty ? "\(slug).md" : "\(folder)/\(slug).md"
        return validNotePath(path) ? path : nil
    }

    public static func validNotePath(_ path: String) -> Bool {
        path.utf8.count <= 180 && path == path.precomposedStringWithCanonicalMapping &&
            path.lowercased().hasSuffix(".md") && validVaultPath(path)
    }

    public static func validFolder(_ folder: String) -> Bool {
        folder.isEmpty || (folder.utf8.count <= 180 && folder == folder.precomposedStringWithCanonicalMapping &&
            validVaultPath(folder))
    }

    public static func validNoteText(_ content: String) -> Bool {
        !content.unicodeScalars.contains(where: { $0.value == 0 }) &&
            content.utf8.count <= maximumNoteBytes
    }

    public static func connectedIDs(in graph: KnowledgeGraph, to nodeID: String) -> Set<String> {
        Set(graph.edges.flatMap { edge -> [String] in
            if edge.source == nodeID { return [edge.target] }
            if edge.target == nodeID { return [edge.source] }
            return []
        })
    }

    public static func taskGroups(_ tasks: [VaultTask], today: String) -> VaultTaskGroups {
        func ordered(_ items: [VaultTask]) -> [VaultTask] {
            items.sorted {
                ($0.dueDate ?? "") != ($1.dueDate ?? "")
                    ? ($0.dueDate ?? "") < ($1.dueDate ?? "")
                    : ($0.dueTime ?? "") != ($1.dueTime ?? "")
                    ? ($0.dueTime ?? "") < ($1.dueTime ?? "")
                    : $0.path != $1.path ? $0.path < $1.path : $0.line < $1.line
            }
        }
        let open = tasks.filter { !$0.done }
        return VaultTaskGroups(
            overdue: ordered(open.filter { ($0.dueDate ?? "") < today && $0.dueDate != nil }),
            today: ordered(open.filter { $0.dueDate == today }),
            upcoming: ordered(open.filter { ($0.dueDate ?? "") > today }),
            noDate: ordered(open.filter { $0.dueDate == nil })
        )
    }

    private static func validVaultPath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"),
              !path.contains("\\"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !path.contains("?"), !path.contains("#"), !path.contains("%") else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
            !$0.isEmpty && $0 != "." && $0 != ".." && !$0.hasPrefix(".")
        }
    }
}

/// Typed client for the shared web vault, task and knowledge routes.
public final class JarvisNotesClient: Sendable {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func languagePreference() async throws -> JarvisNotesLanguage {
        let response = try await request(method: .get, path: ["settings"], idempotent: true)
        guard response.body.count <= 4 * 1024 * 1024,
              let settings = try? JSONDecoder().decode(NotesLanguageResponse.self, from: response.body) else {
            throw JarvisNotesClientError.invalidResponse
        }
        return settings.settings.voice.defaultLanguage
    }

    public func folderTree() async throws -> VaultNoteTree {
        let response = try await request(method: .get, path: ["notes", "tree"], idempotent: true)
        guard response.body.count <= 1024 * 1024,
              let tree = try? JSONDecoder().decode(VaultNoteTree.self, from: response.body),
              tree.directories.count <= 10_000,
              tree.rootNoteCount >= 0, tree.rootNoteCount <= 10_000,
              JarvisNotesLogic.isISODateTime(tree.updatedAt),
              Set(tree.directories).count == tree.directories.count,
              tree.directories.allSatisfy(JarvisNotesLogic.validFolder) else {
            throw JarvisNotesClientError.invalidResponse
        }
        return tree
    }

    public func notes(
        directory: String? = nil,
        query: String? = nil,
        folder: String? = nil,
        offset: Int = 0
    ) async throws -> VaultNotePage {
        guard (directory.map(JarvisNotesLogic.validFolder) ?? true),
              (folder.map(JarvisNotesLogic.validFolder) ?? true),
              (query?.utf16.count ?? 0) <= 500,
              (0...10_000).contains(offset) else {
            throw JarvisNotesClientError.invalidRequest
        }
        var items = [URLQueryItem(name: "limit", value: "50"), URLQueryItem(name: "offset", value: String(offset))]
        if let directory { items.append(URLQueryItem(name: "directory", value: directory)) }
        if let folder { items.append(URLQueryItem(name: "folder", value: folder)) }
        if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(URLQueryItem(name: "query", value: query))
        }
        let response = try await request(
            method: .get, path: ["notes"], query: items, idempotent: true
        )
        guard response.body.count <= 4 * 1024 * 1024,
              let page = try? JSONDecoder().decode(VaultNotePage.self, from: response.body),
              page.notes.count <= 50, page.limit == 50, page.offset == offset,
              Set(page.notes.map(\.path)).count == page.notes.count,
              page.notes.allSatisfy({
                  JarvisNotesLogic.validNotePath($0.path) && !$0.title.isEmpty &&
                      $0.title.utf16.count <= 200 && $0.folder == Self.topFolder($0.path) &&
                      $0.directory == Self.directory($0.path) && JarvisNotesLogic.isISODateTime($0.updatedAt)
              }),
              directory.map({ expected in page.notes.allSatisfy { $0.directory == expected } }) ?? true else {
            throw JarvisNotesClientError.invalidResponse
        }
        return page
    }

    public func readNote(path: String) async throws -> VaultNote {
        guard JarvisNotesLogic.validNotePath(path) else { throw JarvisNotesClientError.invalidRequest }
        let response: HTTPResponse
        do {
            response = try await request(
                method: .get,
                path: ["notes", "note"],
                query: [URLQueryItem(name: "path", value: path)],
                idempotent: true
            )
        } catch JarvisClientError.httpStatus(404) {
            throw JarvisNotesClientError.noteNotFound
        }
        guard response.body.count <= JarvisNotesLogic.maximumNoteBytes + 1024,
              let note = try? JSONDecoder().decode(VaultNote.self, from: response.body),
              note.path == path, JarvisNotesLogic.validNoteText(note.content),
              Self.validGitSHA(note.sha), Self.validGitHubURL(note.url) else {
            throw JarvisNotesClientError.invalidResponse
        }
        return note
    }

    public func createNote(path: String, content: String) async throws -> VaultNoteWrite {
        try await writeNote(path: path, content: content, sha: nil)
    }

    public func saveNote(path: String, content: String, sha: String) async throws -> VaultNoteWrite {
        guard Self.validGitSHA(sha) else { throw JarvisNotesClientError.invalidRequest }
        return try await writeNote(path: path, content: content, sha: sha)
    }

    public func tasks(query: String? = nil, state: VaultTaskState = .open) async throws -> VaultTaskList {
        guard (query?.utf16.count ?? 0) <= 200 else { throw JarvisNotesClientError.invalidRequest }
        var items = [URLQueryItem(name: "state", value: state.rawValue)]
        if let query, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(URLQueryItem(name: "q", value: query))
        }
        let response = try await request(method: .get, path: ["vault", "tasks"], query: items, idempotent: true)
        guard response.body.count <= 4 * 1024 * 1024,
              let list = try? JSONDecoder().decode(VaultTaskList.self, from: response.body),
              list.items.count <= 500, list.total >= list.items.count, list.total >= 0,
              Self.validDate(list.today), JarvisNotesLogic.isISODateTime(list.readAt),
              list.items.allSatisfy(Self.validTask) else {
            throw JarvisNotesClientError.invalidResponse
        }
        return list
    }

    public func setTaskDone(_ task: VaultTask, done: Bool) async throws -> VaultTaskWrite {
        guard Self.validTask(task) else { throw JarvisNotesClientError.invalidRequest }
        let body = TaskCompleteRequest(
            path: task.path, line: task.line, text: task.text, version: task.version, done: done
        )
        do {
            let response = try await request(
                method: .patch,
                path: ["vault", "tasks"],
                body: try JSONEncoder().encode(body),
                idempotent: false,
                additionalSuccessStatuses: [409]
            )
            if response.statusCode == 409 { throw JarvisNotesClientError.taskConflict }
            return try decodeTaskWrite(response.body)
        } catch JarvisClientError.serviceUnavailable {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.networkFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.timedOut {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.responseDecodingFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        }
    }

    public func createTask(
        text: String,
        scope: VaultTaskScope,
        due: String? = nil,
        time: String? = nil
    ) async throws -> VaultTaskWrite {
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...400).contains(cleanText.unicodeScalars.count),
              (due.map(Self.validDate) ?? true),
              (time.map(Self.validTime) ?? true),
              time == nil || due != nil else {
            throw JarvisNotesClientError.invalidRequest
        }
        let body = TaskCreateRequest(text: cleanText, scope: scope, due: due, time: time)
        do {
            let response = try await request(
                method: .post,
                path: ["vault", "tasks"],
                body: try JSONEncoder().encode(body),
                idempotent: false,
                additionalSuccessStatuses: [409]
            )
            if response.statusCode == 409 { throw JarvisNotesClientError.taskConflict }
            return try decodeTaskWrite(response.body)
        } catch JarvisClientError.serviceUnavailable {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.networkFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.timedOut {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.responseDecodingFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        }
    }

    public func graph() async throws -> KnowledgeGraph {
        let response = try await request(method: .get, path: ["knowledge", "graph"], idempotent: true)
        guard response.body.count <= 8 * 1024 * 1024,
              let graph = try? JSONDecoder().decode(KnowledgeGraph.self, from: response.body),
              Self.validGraph(graph) else {
            throw JarvisNotesClientError.invalidResponse
        }
        return graph
    }

    public func searchGraph(_ query: String) async throws -> KnowledgeGraphSearch {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf16.count <= 200 else {
            throw JarvisNotesClientError.invalidRequest
        }
        let graph = try await self.graph()
        let response = try await request(
            method: .get,
            path: ["knowledge", "search"],
            query: [URLQueryItem(name: "q", value: trimmed)],
            idempotent: true
        )
        guard response.body.count <= 1024 * 1024,
              let result = try? JSONDecoder().decode(KnowledgeSearchResponse.self, from: response.body),
              result.hits.count <= 200,
              result.hits.allSatisfy({
                  Self.validFingerprint($0.nodeId) && $0.score.isFinite && (-1...1).contains($0.score) &&
                      $0.snippet.utf16.count <= 500
              }) else {
            throw JarvisNotesClientError.invalidResponse
        }
        let nodeIDs = Set(graph.nodes.map(\.id))
        return KnowledgeGraphSearch(graph: graph, hits: result.hits.filter { nodeIDs.contains($0.nodeId) })
    }

    private func writeNote(path: String, content: String, sha: String?) async throws -> VaultNoteWrite {
        guard JarvisNotesLogic.validNotePath(path), !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              JarvisNotesLogic.validNoteText(content) else {
            throw JarvisNotesClientError.invalidRequest
        }
        let body = NoteWriteRequest(path: path, content: content, sha: sha)
        do {
            let response = try await request(
                method: sha == nil ? .post : .put,
                path: sha == nil ? ["notes"] : ["notes", "note"],
                body: try JSONEncoder().encode(body),
                idempotent: false,
                additionalSuccessStatuses: [409]
            )
            if response.statusCode == 409 {
                throw conflict(from: response.body)
            }
            guard response.body.count <= 1024 * 1024,
                  let write = try? JSONDecoder().decode(VaultNoteWrite.self, from: response.body),
                  write.path == path, Self.validGitSHA(write.commit), Self.validGitHubURL(write.url) else {
                throw JarvisNotesClientError.writeOutcomeUnknown
            }
            return write
        } catch JarvisClientError.httpStatus(404) {
            throw JarvisNotesClientError.noteNotFound
        } catch JarvisClientError.serviceUnavailable {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.networkFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.timedOut {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisClientError.responseDecodingFailure {
            throw JarvisNotesClientError.writeOutcomeUnknown
        } catch JarvisNotesClientError.invalidResponse {
            throw JarvisNotesClientError.writeOutcomeUnknown
        }
    }

    private func request(
        method: HTTPMethod,
        path: [String],
        query: [URLQueryItem] = [],
        body: Data? = nil,
        idempotent: Bool,
        additionalSuccessStatuses: Set<Int> = []
    ) async throws -> HTTPResponse {
        try await client.performAuthenticatedRequest(
            method: method,
            path: path,
            queryItems: query,
            body: body,
            idempotent: idempotent,
            additionalSuccessStatuses: additionalSuccessStatuses
        )
    }

    private func decodeTaskWrite(_ data: Data) throws -> VaultTaskWrite {
        guard data.count <= 1024 * 1024,
              let result = try? JSONDecoder().decode(VaultTaskWrite.self, from: data),
              Self.validFingerprint(result.id), Self.validFingerprint(result.version),
              JarvisNotesLogic.validFolder(result.path),
              (1...1_000_000).contains(result.line) else {
            throw JarvisNotesClientError.writeOutcomeUnknown
        }
        return result
    }

    private func conflict(from data: Data) -> JarvisNotesClientError {
        guard data.count <= JarvisNotesLogic.maximumNoteBytes + 1024,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object.keys.sorted() == ["content", "currentSha", "error"],
              let response = try? JSONDecoder().decode(NoteConflictResponse.self, from: data),
              (response.currentSha == nil && response.content == nil) ||
                (response.currentSha.map(Self.validGitSHA) == true &&
                    response.content.map(JarvisNotesLogic.validNoteText) == true) else {
            return .invalidResponse
        }
        return .noteConflict(currentSha: response.currentSha, content: response.content)
    }

    private static func validTask(_ task: VaultTask) -> Bool {
        Self.validFingerprint(task.id) && Self.validFingerprint(task.version) &&
            task.text.utf16.count <= 300 && JarvisNotesLogic.validFolder(task.path) &&
            (1...1_000_000).contains(task.line) &&
            (task.dueDate.map(validDate) ?? true) &&
            (task.dueTime.map(validTime) ?? true) &&
            (task.dueAt.map(JarvisNotesLogic.isISODateTime) ?? true)
    }

    private static func validGraph(_ graph: KnowledgeGraph) -> Bool {
        guard graph.nodes.count <= 4_000, graph.edges.count <= 20_000,
              JarvisNotesLogic.isISODateTime(graph.updatedAt),
              (graph.openTaskNoteCount.map { (0...4_000).contains($0) } ?? true) else { return false }
        let ids = Set(graph.nodes.map(\.id))
        guard ids.count == graph.nodes.count else { return false }
        return graph.nodes.allSatisfy {
            validFingerprint($0.id) && JarvisNotesLogic.validNotePath($0.path) &&
                !$0.title.isEmpty && $0.title.utf16.count <= 200 &&
                JarvisNotesLogic.validFolder($0.folder) && JarvisNotesLogic.validFolder($0.directory) &&
                JarvisNotesLogic.isISODateTime($0.updatedAt) && (0...40_000).contains($0.degree) &&
                ($0.openTaskCount.map { $0 >= 0 } ?? true)
        } && graph.edges.allSatisfy {
            $0.source != $0.target && ids.contains($0.source) && ids.contains($0.target) &&
                ($0.score.map { $0.isFinite && (-1...1).contains($0) } ?? true)
        }
    }

    private static func validGitSHA(_ value: String) -> Bool {
        value.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil
    }

    private static func validFingerprint(_ value: String) -> Bool {
        value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
    }

    private static func validGitHubURL(_ value: String) -> Bool {
        guard let url = URL(string: value) else { return false }
        return url.scheme == "https" && url.host == "github.com" && url.user == nil && url.password == nil
    }

    private static func validDate(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter.date(from: value) != nil
    }

    private static func validTime(_ value: String) -> Bool {
        value.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    }

    private static func topFolder(_ path: String) -> String {
        path.split(separator: "/").first.map(String.init) ?? ""
    }

    private static func directory(_ path: String) -> String {
        guard let separator = path.lastIndex(of: "/") else { return "" }
        return String(path[..<separator])
    }

    private struct NotesLanguageResponse: Decodable {
        let settings: NotesLanguageSettings
    }

    private struct NotesLanguageSettings: Decodable {
        let voice: NotesVoiceSettings
    }

    private struct NotesVoiceSettings: Decodable {
        let defaultLanguage: JarvisNotesLanguage
    }
}

private struct NoteWriteRequest: Encodable {
    let path: String
    let content: String
    let sha: String?
}

private struct NoteConflictResponse: Decodable {
    let currentSha: String?
    let content: String?
}

private struct TaskCompleteRequest: Encodable {
    let path: String
    let line: Int
    let text: String
    let version: String
    let done: Bool
}

private struct TaskCreateRequest: Encodable {
    let text: String
    let scope: VaultTaskScope
    let due: String?
    let time: String?
}

private struct KnowledgeSearchResponse: Decodable {
    let hits: [KnowledgeSearchHit]
}

private extension JarvisNotesLogic {
    static func isISODateTime(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter()
        if formatter.date(from: value) != nil { return true }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value) != nil
    }
}
