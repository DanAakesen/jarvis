import Foundation
import XCTest
@testable import JarvisCore

final class WorkspaceCommandHandlerTests: XCTestCase {
    func testInterpretsGeneratedViewAndRefusesUnsupportedOperations() throws {
        let view = try JSONDecoder().decode(GeneratedView.self, from: Data("""
        {"version":1,"title":"Synthetic workspace","renderer":"text","source":{"id":"now","status":"complete"},"data":{"format":"plain","content":"Synthetic content"}}
        """.utf8))
        let create = WorkspaceCommand(
            commandId: "fixture_create",
            operation: "create",
            fields: [
                "viewId": .string("fixture_view"),
                "view": try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(view)),
            ]
        )
        let result = WorkspaceCommandInterpreter.interpret(create)
        XCTAssertEqual(result, .supported(.present(viewId: "fixture_view", view: view)))

        let move = WorkspaceCommand(
            commandId: "fixture_move",
            operation: "move",
            fields: ["viewId": .string("fixture_view")]
        )
        XCTAssertEqual(
            WorkspaceCommandInterpreter.interpret(move),
            .refused(reason: "Window positioning is not supported on iPhone.")
        )
    }

    func testFetchesValidatedHTMLArtifactFromWorkspaceEndpoint() async throws {
        let artifactID = "12345678-1234-4234-8234-123456789abc"
        let artifact: [String: Any] = [
            "id": artifactID,
            "kind": "html",
            "title": "Synthetic app",
            "html": "<!doctype html><html><body><main>Synthetic app</main></body></html>",
            "sources": [],
            "createdAt": "2026-01-31T09:00:00.000Z",
            "pinned": false,
        ]
        let scenario: [String: Any] = [
            "version": 1,
            "interactions": [[
                "method": "GET",
                "path": "/api/factory/workspace-artifacts/html/\(artifactID)",
                "response": ["statusCode": 200, "body": artifact],
            ]],
        ]
        let transport = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: scenario))
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: CommandFixtureTokenStore(),
            accessTokenProvider: CommandFixtureTokenProvider()
        )

        let received = try await JarvisWorkspaceClient(client: client).htmlArtifact(id: artifactID)

        XCTAssertEqual(received.id, artifactID)
        XCTAssertEqual(received.html, artifact["html"] as? String)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/factory/workspace-artifacts/html/\(artifactID)"])
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 0)
    }

    func testHTMLArtifactRequestRejectsInvalidIDsAndMismatchedResponses() async throws {
        let artifactID = "12345678-1234-4234-8234-123456789abc"
        let artifact: [String: Any] = [
            "id": "12345678-1234-4234-8234-123456789abd",
            "kind": "html",
            "title": "Synthetic app",
            "html": "<!doctype html><html><body>Synthetic app</body></html>",
            "sources": [],
            "createdAt": "2026-01-31T09:00:00.000Z",
            "pinned": false,
        ]
        let scenario: [String: Any] = [
            "version": 1,
            "interactions": [[
                "method": "GET",
                "path": "/api/factory/workspace-artifacts/html/\(artifactID)",
                "response": ["statusCode": 200, "body": artifact],
            ]],
        ]
        let transport = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: scenario))
        let client = try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: CommandFixtureTokenStore(),
            accessTokenProvider: CommandFixtureTokenProvider()
        )
        let workspaceClient = JarvisWorkspaceClient(client: client)

        do {
            _ = try await workspaceClient.htmlArtifact(id: "../\(artifactID)")
            XCTFail("Expected malformed artifact IDs to be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisWorkspaceClientError, .invalidResponse)
        }
        do {
            _ = try await workspaceClient.htmlArtifact(id: artifactID)
            XCTFail("Expected an artifact with a different ID to be rejected")
        } catch {
            XCTAssertEqual(error as? JarvisWorkspaceClientError, .invalidResponse)
        }
    }

    func testReceivesAndAcknowledgesCommandWithFixtureTransport() async throws {
        let sessionId = "12345678-1234-4234-8234-123456789abc"
        let view: [String: Any] = [
            "version": 1,
            "title": "Synthetic workspace",
            "renderer": "text",
            "source": ["id": "now", "status": "complete"],
            "data": ["format": "plain", "content": "Synthetic content"],
        ]
        let ready = try JSONSerialization.data(withJSONObject: [
            "sessionId": sessionId,
            "trustedBlobHost": "fixture.blob.core.windows.net",
        ])
        let command = try JSONSerialization.data(withJSONObject: [
            "command": [
                "commandId": "fixture_create",
                "operation": "create",
                "viewId": "fixture_view",
                "view": view,
            ],
            "expiresAt": 5_000,
        ])
        let streamText = """
        event: workspace-ready
        data: \(String(decoding: ready, as: UTF8.self))

        event: workspace-command
        data: \(String(decoding: command, as: UTF8.self))

        """
        let scenario: [String: Any] = [
            "version": 1,
            "interactions": [
                [
                    "method": "GET",
                    "path": "/api/now/events",
                    "stream": ["statusCode": 200, "chunks": [["text": streamText]]],
                ],
                [
                    "method": "POST",
                    "path": "/api/now/workspace/commands/fixture_create/ack",
                    "requestBody": ["sessionId": sessionId, "applied": true],
                    "response": ["statusCode": 204],
                ],
            ],
        ]
        let transport = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: scenario))
        let jarvisClient = try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://fixture.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0, delay: .zero, maximumDelay: .zero)
            ),
            transport: transport,
            tokenStore: CommandFixtureTokenStore(),
            accessTokenProvider: CommandFixtureTokenProvider()
        )
        let workspaceClient = JarvisWorkspaceClient(
            client: jarvisClient,
            clock: WaitingWorkspaceClock()
        )
        let signal = WorkspaceCommandEventSignal()
        let listener = Task {
            do {
                for try await event in workspaceClient.events() {
                    if case .workspaceCommand = event { await signal.receive(event) }
                }
            } catch {}
        }

        let event = await signal.wait()
        guard case .workspaceCommand(
            let receivedCommand,
            let expiresAtMilliseconds,
            let trustedBlobHost
        ) = event else {
            return XCTFail("Expected a workspace command event")
        }
        XCTAssertEqual(trustedBlobHost, "fixture.blob.core.windows.net")
        let interpretation = WorkspaceCommandInterpreter.interpret(
            receivedCommand,
            trustedBlobHost: trustedBlobHost
        )
        guard case .supported(.present) = interpretation else {
            return XCTFail("Expected the generated view command to be supported")
        }

        try await WorkspaceCommandProcessor().acknowledge(
            command: receivedCommand,
            expiresAtMilliseconds: expiresAtMilliseconds,
            trustedBlobHost: trustedBlobHost,
            using: workspaceClient
        ) { command, host in
            WorkspaceCommandInterpreter.interpret(command, trustedBlobHost: host) == interpretation
                ? .applied
                : .error(reason: "Synthetic command was not applied.")
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), [
            "/api/now/events",
            "/api/now/workspace/commands/fixture_create/ack",
        ])
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 0)
        listener.cancel()
        await listener.value
    }
}

private actor CommandFixtureTokenStore: TokenStore {
    func read() async throws -> String? { "session.fixture.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor CommandFixtureTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "entra.fixture.token" }
    func requestSignIn() async {}
}

private struct WaitingWorkspaceClock: WorkspaceClock {
    func now() async -> Date { Date(timeIntervalSince1970: 1) }

    func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: .seconds(60))
    }
}

private actor WorkspaceCommandEventSignal {
    private var event: WorkspaceEvent?
    private var continuation: CheckedContinuation<WorkspaceEvent, Never>?

    func receive(_ event: WorkspaceEvent) {
        if let continuation {
            self.continuation = nil
            continuation.resume(returning: event)
        } else {
            self.event = event
        }
    }

    func wait() async -> WorkspaceEvent {
        if let event { return event }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }
}
