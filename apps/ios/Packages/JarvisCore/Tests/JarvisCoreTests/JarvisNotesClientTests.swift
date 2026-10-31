import Foundation
import XCTest
@testable import JarvisCore

final class JarvisNotesClientTests: XCTestCase {
    func testNotesLocalizationIsCompleteAndUsesBoardDanish() {
        XCTAssertEqual(JarvisAppLanguage.default, .da)
        for key in JarvisNotesLocalizationKey.allCases {
            XCTAssertNotEqual(
                JarvisNotesLocalization.string(key, language: .da),
                key.rawValue
            )
            XCTAssertNotEqual(
                JarvisNotesLocalization.string(key, language: .en),
                key.rawValue
            )
        }

        XCTAssertEqual(JarvisNotesLocalization.string(.title, language: .da), "Noter")
        XCTAssertEqual(JarvisNotesLocalization.string(.tasks, language: .da), "Opgaver")
        XCTAssertEqual(JarvisNotesLocalization.string(.search, language: .da), "Søg")
        XCTAssertEqual(JarvisNotesLocalization.string(.newNote, language: .da), "Ny note")
        XCTAssertEqual(JarvisNotesLocalization.string(.newTask, language: .da), "Ny opgave")
        XCTAssertEqual(JarvisNotesLocalization.string(.overdue, language: .da), "Forfaldne")
        XCTAssertEqual(JarvisNotesLocalization.string(.upcoming, language: .da), "Kommende")
        XCTAssertEqual(JarvisNotesLocalization.string(.noDate, language: .da), "Uden dato")
        XCTAssertEqual(JarvisNotesLocalization.string(.personal, language: .da), "Privat")
        XCTAssertEqual(JarvisNotesLocalization.string(.work, language: .da), "Arbejde")
        XCTAssertEqual(JarvisNotesLocalization.string(.reload, language: .da), "Genindlæs seneste")
        XCTAssertEqual(JarvisNotesLocalization.string(.keepDraft, language: .da), "Behold min")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceCaptionYou, language: .da), "Dig")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceHideCaptions, language: .da), "Skjul undertekster")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceCaptionYou, language: .en), "You")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceHideCaptions, language: .en), "Hide captions")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceShowCaptions, language: .da), "Vis undertekster")
        XCTAssertEqual(JarvisNotesLocalization.string(.voiceShowCaptions, language: .en), "Show captions")
    }

    func testNotesDatesFollowTheSelectedAppLanguage() {
        let updatedAt = "2026-10-30T12:00:00.000Z"
        let dueDate = "2026-10-30"
        let dueTime = "10:00"

        XCTAssertNotEqual(
            JarvisNotesLocalization.formattedUpdatedDate(updatedAt, language: .da),
            JarvisNotesLocalization.formattedUpdatedDate(updatedAt, language: .en)
        )
        XCTAssertNotEqual(
            JarvisNotesLocalization.formattedDueDate(dueDate, language: .da),
            JarvisNotesLocalization.formattedDueDate(dueDate, language: .en)
        )
        XCTAssertNotEqual(
            JarvisNotesLocalization.formattedDueTime(dueTime, language: .da),
            JarvisNotesLocalization.formattedDueTime(dueTime, language: .en)
        )
        XCTAssertEqual(JarvisNotesLocalization.formattedDueDate("invalid", language: .da), "invalid")
    }

    func testNotesTreeListReadCreateAndConflictUseSharedRoutes() async throws {
        let transport = try notesFixture("notes")
        let notes = JarvisNotesClient(client: try makeClient(transport))

        let tree = try await notes.folderTree()
        let page = try await notes.notes(directory: "Work")
        let note = try await notes.readNote(path: "Work/synthetic_note.md")
        let created = try await notes.createNote(path: "Work/new_note.md", content: "Synthetic draft")

        XCTAssertEqual(tree.directories, ["Work"])
        XCTAssertEqual(page.notes.map(\.path), ["Work/synthetic_note.md"])
        XCTAssertEqual(note.content, "Synthetic note content.")
        XCTAssertEqual(created.path, "Work/new_note.md")
        do {
            _ = try await notes.saveNote(
                path: note.path,
                content: "Synthetic changed draft",
                sha: note.sha
            )
            XCTFail("Expected a stale-note conflict")
        } catch {
            XCTAssertEqual(
                error as? JarvisNotesClientError,
                .noteConflict(currentSha: String(repeating: "b", count: 40), content: "Synthetic changed note.")
            )
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .get, .get, .post, .put])
        XCTAssertEqual(requests.map(\.path), [
            "/api/notes/tree",
            "/api/notes",
            "/api/notes/note",
            "/api/notes",
            "/api/notes/note",
        ])
        XCTAssertEqual(requests[1].query, ["limit": "50", "offset": "0", "directory": "Work"])
        await assertConsumed(transport)
    }

    func testTasksGroupCompleteCreateAndDoNotRetryUnknownWrites() async throws {
        let transport = try notesFixture("tasks")
        let notes = JarvisNotesClient(client: try makeClient(transport))
        let list = try await notes.tasks()
        let groups = JarvisNotesLogic.taskGroups(list.items, today: list.today)

        XCTAssertEqual(groups.overdue.map(\.text), ["Synthetic overdue"])
        XCTAssertEqual(groups.today.map(\.text), ["Synthetic today"])
        XCTAssertEqual(groups.upcoming.map(\.text), ["Synthetic upcoming"])
        XCTAssertEqual(groups.noDate.map(\.text), ["Synthetic no date"])
        XCTAssertEqual(list.items.first?.scope, .work)
        let completed = try await notes.setTaskDone(list.items[0], done: true)
        XCTAssertTrue(completed.done)
        _ = try await notes.createTask(
            text: "Synthetic new task",
            scope: .personal,
            due: "2026-10-31",
            time: "10:00"
        )
        do {
            _ = try await notes.createTask(text: "Synthetic uncertain task", scope: .work)
            XCTFail("Expected an uncertain write outcome")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .writeOutcomeUnknown)
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .patch, .post, .post])
        XCTAssertEqual(requests.map(\.path), [
            "/api/vault/tasks",
            "/api/vault/tasks",
            "/api/vault/tasks",
            "/api/vault/tasks",
        ])
        XCTAssertEqual(requests[0].query, ["state": "open"])
        await assertConsumed(transport)
    }

    func testGraphSearchLoadsGraphFirstAndDropsUnknownNodeIDs() async throws {
        let transport = try notesFixture("graph-search")
        let notes = JarvisNotesClient(client: try makeClient(transport))

        let result = try await notes.searchGraph("synthetic note")

        XCTAssertEqual(result.graph.nodes.map(\.path), ["Work/synthetic_note.md"])
        XCTAssertEqual(result.hits.map(\.nodeId), [String(repeating: "a", count: 64)])
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .get])
        XCTAssertEqual(requests.map(\.path), ["/api/knowledge/graph", "/api/knowledge/search"])
        XCTAssertEqual(requests.last?.query, ["q": "synthetic note"])
        await assertConsumed(transport)
    }

    func testFolderTreeAndGraphPositionsAreStableAndBounded() throws {
        let folders = JarvisNotesPresentation.folderTree(["Work/Projects", "Work", "Personal/Plans"])
        XCTAssertEqual(folders.map(\.path), ["Personal", "Work"])
        XCTAssertEqual(folders[1].children.map(\.path), ["Work/Projects"])

        let graph = try JSONDecoder().decode(KnowledgeGraph.self, from: Data("""
        {
          "nodes": [
            {"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"Work/a_note.md","title":"A","folder":"Work","directory":"Work","updatedAt":"2026-10-30T00:00:00Z","degree":1},
            {"id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","path":"Work/b_note.md","title":"B","folder":"Work","directory":"Work","updatedAt":"2026-10-30T00:00:00Z","degree":1}
          ],
          "edges": [],
          "updatedAt":"2026-10-30T00:00:00Z"
        }
        """.utf8))
        let positions = JarvisNotesPresentation.graphPositions(graph)
        XCTAssertEqual(positions.count, 2)
        XCTAssertTrue(positions.values.allSatisfy { (0...1).contains($0.x) && (0...1).contains($0.y) })
        XCTAssertEqual(positions, JarvisNotesPresentation.graphPositions(graph))
    }

    func testRejectsUnsafeNotePathsAndTaskTimesWithoutADateBeforeRequests() async throws {
        let transport = try notesFixture("empty")
        let notes = JarvisNotesClient(client: try makeClient(transport))

        XCTAssertNil(JarvisNotesLogic.notePath(folder: "../Work", title: "Synthetic"))
        XCTAssertEqual(JarvisNotesLogic.notePath(folder: "Work", title: "Résumé notes"), "Work/resume-notes.md")
        do {
            _ = try await notes.createTask(text: "Synthetic task", scope: .work, time: "10:00")
            XCTFail("A task time requires a date")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .invalidRequest)
        }
        do {
            _ = try await notes.createNote(path: "../secret.md", content: "Synthetic")
            XCTFail("An unsafe note path must be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .invalidRequest)
        }
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 1)
    }

    private func makeClient(_ transport: FixtureTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 2, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: NotesTokenStore(),
            accessTokenProvider: NotesTokenProvider()
        )
    }
}

private func notesFixture(_ name: String) throws -> FixtureTransport {
    guard let url = Bundle.module.url(
        forResource: name,
        withExtension: "json",
        subdirectory: "Resources"
    ) else {
        throw CocoaError(.fileNoSuchFile)
    }
    let data = try Data(contentsOf: url)
    let json = String(decoding: data, as: UTF8.self)
        .replacingOccurrences(of: "https://demo.invalid", with: "https://github.com")
    return try FixtureTransport(scenario: Data(json.utf8))
}

private func assertConsumed(
    _ transport: FixtureTransport,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    let remaining = await transport.remainingInteractions()
    XCTAssertEqual(remaining, 0, file: file, line: line)
}

private actor NotesTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor NotesTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}
