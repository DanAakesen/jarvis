import Foundation
import JarvisCore
import SwiftUI

#Preview("Noter · Dansk") {
    NavigationStack {
        JarvisNotesArea(
            client: JarvisNotesPreview.makeClient(),
            language: .da,
            onRetryConfiguration: {}
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.da.locale)
}

#Preview("Notes · English") {
    NavigationStack {
        JarvisNotesArea(
            client: JarvisNotesPreview.makeClient(),
            language: .en,
            onRetryConfiguration: {}
        )
    }
    .environmentObject(JarvisNavigationModel())
    .environment(\.locale, JarvisAppLanguage.en.locale)
}

enum JarvisNotesPreview {
    static func makeClient() -> JarvisNotesClient? {
        guard let client = try? JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://preview.invalid/api")!, retryPolicy: RetryPolicy(maximumRetries: 0)),
            transport: JarvisNotesPreviewTransport(boardTasks: ProcessInfo.processInfo.arguments.contains("--ui-test-task-list-board")),
            tokenStore: JarvisNotesPreviewTokenStore(),
            accessTokenProvider: JarvisNotesPreviewTokenProvider()
        ) else { return nil }
        return JarvisNotesClient(client: client)
    }
}

/// Synthetic state for previews and UI tests. Requests may arrive in any navigation order.
private actor JarvisNotesPreviewTransport: HTTPTransport {
    private struct Note {
        let path: String
        let title: String
        var content: String
        var sha = String(repeating: "a", count: 40)
        var directory: String { path.split(separator: "/").dropLast().joined(separator: "/") }
        var folder: String { directory.split(separator: "/").first.map(String.init) ?? "" }
    }
    private var notes: [Note] = [
        Note(path: "welcome.md", title: "Welcome — synthetic", content: "# Welcome\n\nSynthetic root note."),
        Note(path: "Work/Projects/release.md", title: "Release plan — synthetic", content: "# Release plan\n\nSynthetic project note."),
        Note(path: "Personal/weekend.md", title: "Weekend — synthetic", content: "# Weekend\n\nSynthetic personal note."),
    ]
    private var inventory = ["Work", "Work/Projects", "Personal", "Attachments/Scans"]
    private let timestamp = "2026-11-05T09:00:00Z"
    private var tasks: [[String: Any]] = [[
        "id": String(repeating: "1", count: 64), "text": "Review release — synthetic", "done": false,
        "dueDate": "2026-11-05", "dueTime": NSNull(), "dueAt": NSNull(), "priority": "medium",
        "path": "Work/Projects/release.md", "line": 3, "heading": NSNull(), "version": String(repeating: "a", count: 64),
    ]]

    init(boardTasks: Bool = false) {
        guard boardTasks else { return }
        // Synthetic long titles and mixed metadata exercise the owner's task-list finding.
        let samples: [(String, String?, String?, String, String, String?)] = [
            ("Investigate the sample service catalog and prepare a recommendation for the project review", "2026-10-27", nil, "medium", "Personal", nil),
            ("**4. Review the sample agreement** · synthetic deadline", "2026-10-28", "10:00", "high", "Work", "Project kickoff"),
            ("Review roadmap draft", "2026-11-05", "14:30", "medium", "Work", "Roadmap draft"),
            ("Call the sample supplier", "2026-11-05", "16:00", "normal", "Work", "Supplier"),
            ("Water the plants", "2026-11-05", nil, "normal", "Personal", "Garden plan"),
            ("Draft budget sketch", "2026-11-06", "09:00", "normal", "Work", "Budget sketch"),
            ("Plan trip outline", "2026-11-09", nil, "normal", "Personal", "Trip outline"),
            ("Sort reference links", nil, nil, "normal", "Personal", nil),
            ("Finish the synthetic checklist", nil, nil, "high", "Work", nil),
        ]
        tasks = samples.enumerated().map { index, sample in
            let noteName = index == 2 ? "Roadmap draft" : [0, 8].contains(index) ? "Tasks" : "Synthetic"
            let heading: String? = [0, 2, 8].contains(index) ? "Tasks" : sample.5
            return ["id": String(repeating: "0", count: 63) + String(index + 1, radix: 16),
             "text": sample.0, "done": false,
             "dueDate": sample.1 as Any? ?? NSNull(), "dueTime": sample.2 as Any? ?? NSNull(),
             "dueAt": NSNull(), "priority": sample.3,
             "path": "\(sample.4)/\(noteName).md",
             "line": index + 1,
             "heading": heading as Any? ?? NSNull(),
             "version": String(repeating: "a", count: 64)]
        }
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let query = Dictionary((URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })
        let body = request.body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        switch (request.method, request.url.path) {
        case (.get, "/api/notes/tree"):
            return try json(["directories": inventory, "rootNoteCount": notes.filter { $0.directory.isEmpty }.count,
                             "truncated": false, "updatedAt": timestamp])
        case (.get, "/api/notes"):
            let matches = notes.filter {
                if let directory = query["directory"] { return $0.directory == directory }
                if let folder = query["folder"] { return $0.folder == folder }
                return true
            }
            let offset = Int(query["offset"] ?? "0") ?? 0
            let limit = Int(query["limit"] ?? "50") ?? 50
            return try json(["notes": matches.dropFirst(max(0, offset)).prefix(max(0, limit)).map(summary),
                             "limit": limit, "offset": offset, "hasMore": offset + limit < matches.count])
        case (.post, "/api/notes/folders"):
            guard let path = body["path"] as? String, !path.isEmpty, JarvisNotesLogic.validFolder(path),
                  !inventory.contains(where: { $0 == path || $0.hasPrefix(path + "/") }) else {
                return try json(["error": "Synthetic folder conflict"], status: 409)
            }
            inventory.append(path)
            return try json(["path": path, "commit": String(repeating: "b", count: 40)])
        case (.get, "/api/notes/note"):
            guard let note = notes.first(where: { $0.path == query["path"] }) else { return try json(["error": "Synthetic note missing"], status: 404) }
            return try json(["path": note.path, "content": note.content, "sha": note.sha, "url": noteURL(note.path)])
        case (.post, "/api/notes"):
            guard let path = body["path"] as? String, let content = body["content"] as? String,
                  JarvisNotesLogic.validNotePath(path), !notes.contains(where: { $0.path == path }) else {
                return try json(["error": "Synthetic note conflict"], status: 409)
            }
            let title = path.split(separator: "/").last.map(String.init)?.replacingOccurrences(of: ".md", with: "") ?? path
            let note = Note(path: path, title: title, content: content)
            notes.append(note)
            if !note.directory.isEmpty, !inventory.contains(note.directory) { inventory.append(note.directory) }
            return try json(["path": path, "commit": String(repeating: "b", count: 40), "url": noteURL(path)])
        case (.put, "/api/notes/note"):
            guard let path = body["path"] as? String, let content = body["content"] as? String,
                  let index = notes.firstIndex(where: { $0.path == path }) else { return try json(["error": "Synthetic note missing"], status: 404) }
            guard body["sha"] as? String == notes[index].sha else {
                return try json(["currentSha": notes[index].sha, "content": notes[index].content], status: 409)
            }
            notes[index].content = content
            notes[index].sha = String(repeating: "b", count: 40)
            return try json(["path": path, "commit": notes[index].sha, "url": noteURL(path)])
        case (.get, "/api/knowledge/graph"):
            return try json(["nodes": notes.enumerated().map { index, note in
                summary(note).merging(["id": nodeID(index), "degree": 0, "openTaskCount": 0]) { _, new in new }
            }, "edges": [], "updatedAt": timestamp])
        case (.get, "/api/knowledge/search"):
            let q = query["q"] ?? ""
            return try json(["hits": notes.enumerated().filter { $0.element.title.localizedCaseInsensitiveContains(q) }
                .map { ["nodeId": nodeID($0.offset), "score": 1, "snippet": "Synthetic preview"] }])
        case (.get, "/api/vault/tasks"):
            let visible = tasks.filter { query["state"] == "all" || ($0["done"] as? Bool != true) }
            return try json(["items": visible, "readAt": timestamp, "today": "2026-11-05", "total": visible.count, "truncated": false])
        case (.post, "/api/vault/tasks"):
            let item: [String: Any] = ["id": nodeID(tasks.count + 100), "text": body["text"] ?? "Synthetic task", "done": false,
                "dueDate": body["due"] ?? NSNull(), "dueTime": body["time"] ?? NSNull(), "dueAt": NSNull(),
                "priority": body["priority"] ?? "normal", "path": body["scope"] as? String == "work" ? "Work/Inbox.md" : "Personal/Inbox.md",
                "line": tasks.count + 1, "heading": NSNull(), "version": String(repeating: "a", count: 64)]
            tasks.append(item)
            return try json(item.merging(["commit": String(repeating: "b", count: 40)]) { _, new in new })
        case (.patch, "/api/vault/tasks"):
            guard let index = tasks.firstIndex(where: { ($0["path"] as? String) == (body["path"] as? String) && ($0["line"] as? Int) == (body["line"] as? Int) }) else {
                return try json(["error": "Synthetic task conflict"], status: 409)
            }
            tasks[index]["done"] = body["done"] ?? true
            return try json(tasks[index].merging(["commit": String(repeating: "b", count: 40)]) { _, new in new })
        default:
            return try json(["error": "Unsupported synthetic request"], status: 404)
        }
    }

    func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse { throw JarvisNotesClientError.invalidRequest }
    private func summary(_ note: Note) -> [String: Any] {
        ["path": note.path, "title": note.title, "folder": note.folder, "directory": note.directory, "updatedAt": timestamp]
    }
    private func nodeID(_ index: Int) -> String { String(format: "%064x", index + 1) }
    private func noteURL(_ path: String) -> String { "https://github.com/fixture/notes/blob/main/" + path }
    private func json(_ value: [String: Any], status: Int = 200) throws -> HTTPResponse {
        HTTPResponse(statusCode: status, headers: ["content-type": "application/json"], body: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
    }
}

private actor JarvisNotesPreviewTokenStore: TokenStore {
    func read() async throws -> String? { "preview.session_token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor JarvisNotesPreviewTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String {
        "preview.access_token"
    }

    func requestSignIn() async {}
}
