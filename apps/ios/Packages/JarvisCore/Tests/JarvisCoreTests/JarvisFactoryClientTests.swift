import Foundation
import XCTest
@testable import JarvisCore

final class JarvisFactoryClientTests: XCTestCase {
    func testFactoryRoutesFilteringControlsIdempotentCreationPolicyAndReleases() async throws {
        let transport = try FixtureTransport(scenario: Data(factoryScenario.utf8))
        let client = JarvisFactoryClient(client: try makeClient(transport))

        let projects = try await client.projects()
        XCTAssertEqual(projects.map(\.name), ["Synthetic project"])

        let board = try await client.board(projectId: "7")
        XCTAssertTrue(board.stale)
        let boardCards = JarvisFactoryPresentation.cards(from: board, segment: .board)
        XCTAssertEqual(boardCards.map(\.card.issue.number), [9])
        XCTAssertEqual(
            JarvisFactoryPresentation.cards(from: board, segment: .needsDan).map(\.card.issue.number),
            [10]
        )
        XCTAssertEqual(
            JarvisFactoryPresentation.cards(from: board, segment: .board, search: "#9").first?.column,
            .inProgress
        )
        XCTAssertTrue(JarvisFactoryPresentation.cards(from: board, segment: .board, search: "#10").isEmpty)
        XCTAssertEqual(JarvisFactoryPresentation.defaultCollapsedColumns(), [.done])

        let filteredTasks = try await client.tasks(projectId: "7", agent: .copilot, state: .needsAttention)
        XCTAssertEqual(filteredTasks.tasks.map(\.id), ["41"])
        let detail = try await client.task(id: "41", eventLimit: 20, eventOffset: 2)
        XCTAssertEqual(detail.task.request, "Synthetic request")
        XCTAssertEqual(detail.events.first?.id, "5")
        XCTAssertEqual(detail.usage.first?.quantity, 7)
        XCTAssertEqual(
            JarvisFactoryPresentation.availableControls(
                state: detail.task.state,
                latestSessionEndReason: detail.task.latestSessionEndReason
            ),
            [.recover, .cancel]
        )
        XCTAssertEqual(
            JarvisFactoryPresentation.availableControls(state: .done, latestSessionEndReason: .done),
            []
        )

        let recover = FactoryTaskControlRequest(taskId: "41", action: .recover)
        do {
            _ = try await client.controlTask(recover)
            XCTFail("Expected a confirmation response")
        } catch {
            XCTAssertEqual(
                error as? JarvisFactoryClientError,
                .confirmationRequired(reason: "issue_closed", message: "Restart needs confirmation")
            )
        }
        let recovered = try await client.controlTask(recover, confirm: true)
        XCTAssertEqual(recovered.state, .running)

        let submission = FactoryTaskSubmission(
            projectId: "7",
            title: "Synthetic task",
            request: "Synthetic request",
            agent: .copilot,
            submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        )
        let created = try await client.createTask(submission)
        let retried = try await client.createTask(submission)
        XCTAssertEqual(created.id, "42")
        XCTAssertEqual(retried.id, "42")

        let updatedProject = try await client.updatePolicy(
            projectId: "7",
            policy: .completeWithoutDeployment
        )
        XCTAssertEqual(updatedProject.policy, .completeWithoutDeployment)

        let releases = try await client.releases(projectId: "7")
        XCTAssertTrue(releases.graph?.truncated == true)
        XCTAssertEqual(releases.graph?.commits.first?.sha, "abc123")
        XCTAssertEqual(
            JarvisFactoryPresentation.linkedTaskIDs(for: releases.releases[0], in: releases),
            ["41"]
        )

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), [
            "/api/factory/projects",
            "/api/factory/board",
            "/api/factory/tasks",
            "/api/factory/tasks/41",
            "/api/factory/tasks/41/controls",
            "/api/factory/tasks/41/controls",
            "/api/factory/tasks",
            "/api/factory/tasks",
            "/api/factory/projects/7",
            "/api/factory/projects/7/releases",
        ])
        XCTAssertEqual(requests[1].query, ["project": "7"])
        XCTAssertEqual(requests[2].query, [
            "projectId": "7", "agent": "copilot", "state": "NeedsAttention", "limit": "50", "offset": "0",
        ])
        XCTAssertEqual(requests[3].query, ["eventLimit": "20", "eventOffset": "2"])
        await assertConsumed(transport)
    }

    func testExistingNowAndTaskEventStreamsDecodeFactoryUpdates() async throws {
        let transport = try FixtureTransport(scenario: Data(streamScenario.utf8))
        let client = JarvisFactoryClient(client: try makeClient(transport))
        var updates: [FactoryBoardUpdate] = []
        var events: [FactoryTaskEvent] = []

        try await client.listenForBoardUpdates { updates.append($0) }
        try await client.listenForTaskEvents(taskId: "41", after: "5") { events.append($0) }

        XCTAssertEqual(updates, [FactoryBoardUpdate(projectId: "7", version: 2)])
        XCTAssertEqual(events.map(\.id), ["6"])
        XCTAssertEqual(events.first?.summary, "Synthetic update")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.path), ["/api/now/events", "/api/factory/tasks/41/events"])
        await assertConsumed(transport)
    }

    func testFactoryPresentationAndCopyAreCompleteInBothLanguages() throws {
        for key in JarvisFactoryLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .en), key.rawValue)
        }
        XCTAssertEqual(JarvisFactoryLocalization.string(.board, language: .da), "Board")
        XCTAssertEqual(JarvisFactoryLocalization.string(.needsDan, language: .en), "Needs Dan")
        XCTAssertEqual(JarvisFactoryLocalization.string(.createTask, language: .da), "Opret opgave")
        XCTAssertEqual(JarvisFactoryLocalization.string(.createTask, language: .en), "Create task")

        let valid = FactoryTaskSubmission(
            projectId: "7",
            title: "Synthetic",
            request: "Synthetic request",
            agent: .codex,
            submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        )
        XCTAssertTrue(valid.isValid)
        XCTAssertFalse(FactoryTaskSubmission(
            projectId: "0",
            title: "Synthetic",
            request: "Synthetic request",
            agent: .codex
        ).isValid)
        XCTAssertFalse(FactoryTaskControlRequest(taskId: "41", action: .steer).isValid)
        XCTAssertFalse(FactoryTaskControlRequest(taskId: "41", action: .pause, message: "unexpected").isValid)
    }

    private func makeClient(_ transport: FixtureTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: FactoryTokenStore(),
            accessTokenProvider: FactoryTokenProvider()
        )
    }
}

private actor FactoryTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor FactoryTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}

private func assertConsumed(
    _ transport: FixtureTransport,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    let remaining = await transport.remainingInteractions()
    XCTAssertEqual(remaining, 0, "Fixture interactions remain", file: file, line: line)
}

private let factoryScenario = #"""
{
  "version": 1,
  "interactions": [
    {
      "method": "GET",
      "path": "/api/factory/projects",
      "response": {
        "statusCode": 200,
        "body": [{
          "id": "7", "name": "Synthetic project", "repo": "sample/repo", "default_branch": "main",
          "default_agent": "codex", "policy": "deliver_pr"
        }]
      }
    },
    {
      "method": "GET",
      "path": "/api/factory/board",
      "query": {"project": "7"},
      "response": {
        "statusCode": 200,
        "body": {
          "project": {"id": "7", "repo": "sample/repo"},
          "fetchedAt": "2026-10-31T09:00:00Z",
          "stale": true,
          "columns": [
            {"id": "backlog", "cards": []},
            {"id": "needs_dan", "cards": [{
              "issue": {
                "number": 10, "url": "https://github.com/sample/repo/issues/10", "title": "Synthetic decision",
                "taskCode": null, "labels": ["needs-decision"], "worker": null, "state": "open",
                "updatedAt": "2026-10-31T08:30:00Z", "closedAt": null, "blockedBy": []
              },
              "pr": null,
              "task": {
                "id": "42", "state": "NeedsAttention", "agent": "codex", "activity": "Synthetic decision",
                "attemptCount": 1, "branch": null, "startedAt": null, "latestSessionEndReason": null
              }
            }]},
            {"id": "ready", "cards": []},
            {"id": "in_progress", "cards": [{
              "issue": {
                "number": 9, "url": "https://github.com/sample/repo/issues/9", "title": "Synthetic task",
                "taskCode": null, "labels": ["Copilot"], "worker": "Copilot", "state": "open",
                "updatedAt": "2026-10-31T08:00:00Z", "closedAt": null, "blockedBy": [3]
              },
              "pr": {"number": 19, "url": "https://github.com/sample/repo/pull/19", "draft": false, "checks": "pending"},
              "task": {
                "id": "41", "state": "NeedsAttention", "agent": "copilot", "activity": "Synthetic blocked",
                "attemptCount": 2, "branch": "copilot/work", "startedAt": "2026-10-31T08:00:00Z",
                "latestSessionEndReason": "crashed"
              }
            }]},
            {"id": "in_review", "cards": []},
            {"id": "done", "cards": []}
          ]
        }
      }
    },
    {
      "method": "GET",
      "path": "/api/factory/tasks",
      "query": {"projectId": "7", "agent": "copilot", "state": "NeedsAttention", "limit": "50", "offset": "0"},
      "response": {"statusCode": 200, "body": {"tasks": [TASK41], "limit": 50, "offset": 0}}
    },
    {
      "method": "GET",
      "path": "/api/factory/tasks/41",
      "query": {"eventLimit": "20", "eventOffset": "2"},
      "response": {
        "statusCode": 200,
        "body": {
          "id": "41", "projectId": "7", "issueNumber": 9, "originMessageId": null,
          "title": "Synthetic task", "request": "Synthetic request", "source": "board", "agent": "copilot",
          "modelOverride": null, "reasoningOverride": null, "state": "NeedsAttention",
          "activity": "Synthetic blocked", "priority": 0, "attemptCount": 2, "nextAttemptAt": null,
          "branch": "copilot/work", "pullRequest": null, "checks": null, "checkConclusion": null,
          "usageSummary": null, "latestSessionEndReason": "crashed",
          "createdAt": "2026-10-31T07:00:00Z", "startedAt": "2026-10-31T08:00:00Z", "finishedAt": null,
          "events": [{
            "id": "5", "taskId": "41", "type": "disk", "summary": "Synthetic disk sample",
            "payload": {"freeBytes": 100}, "payloadTruncated": false, "source": "runner",
            "at": "2026-10-31T08:30:00Z"
          }],
          "usage": [{
            "id": "usage-1", "source": "sandbox", "metric": "minutes", "quantity": 7,
            "costDkk": null, "sandboxSessionId": "session-1",
            "at": "2026-10-31T08:30:00Z", "estimated": true
          }]
        }
      }
    },
    {
      "method": "POST",
      "path": "/api/factory/tasks/41/controls",
      "requestBody": {"action": "recover"},
      "response": {
        "statusCode": 409,
        "body": {"error": "Restart needs confirmation", "reason": "issue_closed", "confirmationRequired": true}
      }
    },
    {
      "method": "POST",
      "path": "/api/factory/tasks/41/controls",
      "requestBody": {"action": "recover", "confirm": true},
      "response": {"statusCode": 200, "body": TASK41_RUNNING}
    },
    {
      "method": "POST",
      "path": "/api/factory/tasks",
      "requestBody": {
        "projectId": "7", "submissionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "title": "Synthetic task", "request": "Synthetic request", "agent": "copilot"
      },
      "response": {"statusCode": 201, "body": TASK42}
    },
    {
      "method": "POST",
      "path": "/api/factory/tasks",
      "requestBody": {
        "projectId": "7", "submissionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "title": "Synthetic task", "request": "Synthetic request", "agent": "copilot"
      },
      "response": {"statusCode": 201, "body": TASK42}
    },
    {
      "method": "PATCH",
      "path": "/api/factory/projects/7",
      "requestBody": {"policy": "complete_without_deployment"},
      "response": {
        "statusCode": 200,
        "body": {
          "id": "7", "name": "Synthetic project", "repo": "sample/repo", "default_branch": "main",
          "default_agent": "codex", "policy": "complete_without_deployment"
        }
      }
    },
    {
      "method": "GET",
      "path": "/api/factory/projects/7/releases",
      "response": {
        "statusCode": 200,
        "body": {
          "project": {"id": "7", "name": "Synthetic project", "repo": "sample/repo", "defaultBranch": "main"},
          "releases": [{
            "id": "88", "version": "0.8.0", "sha": "abc123", "status": "released",
            "createdAt": "2026-10-30T12:00:00Z", "releasedAt": "2026-10-30T12:30:00Z"
          }],
          "pullRequests": [{
            "id": "19", "number": 19, "branch": "copilot/work", "headSha": "abc123",
            "state": "merged", "checks": "passed", "taskId": "41"
          }],
          "workflowRuns": [{
            "id": "run-1", "workflow": "CI", "trigger": "push", "headSha": "abc123",
            "status": "completed", "conclusion": "success", "startedAt": "2026-10-30T12:00:00Z",
            "completedAt": "2026-10-30T12:10:00Z", "releaseId": "88",
            "pullRequestNumber": 19, "taskId": null
          }],
          "deployments": [{
            "id": "deployment-1", "releaseId": "88", "environment": "production",
            "status": "success", "at": "2026-10-30T12:30:00Z"
          }],
          "graph": {
            "fetchedAt": "2026-10-31T08:00:00Z", "truncated": true, "branches": [],
            "commits": [{
              "sha": "abc123", "message": "Synthetic commit", "author": "Fixture",
              "committedAt": "2026-10-30T12:00:00Z", "parents": []
            }]
          }
        }
      }
    }
  ]
}
"""#
    .replacingOccurrences(of: "TASK41_RUNNING", with: #"{"id":"41","projectId":"7","issueNumber":9,"originMessageId":null,"title":"Synthetic task","request":"Synthetic request","source":"board","agent":"copilot","modelOverride":null,"reasoningOverride":null,"state":"Running","activity":"Synthetic running","priority":0,"attemptCount":3,"nextAttemptAt":null,"branch":"copilot/work","pullRequest":null,"checks":null,"checkConclusion":null,"usageSummary":null,"latestSessionEndReason":"crashed","createdAt":"2026-10-31T07:00:00Z","startedAt":"2026-10-31T08:00:00Z","finishedAt":null}"#)
    .replacingOccurrences(of: "TASK42", with: #"{"id":"42","projectId":"7","issueNumber":10,"originMessageId":null,"title":"Synthetic task","request":"Synthetic request","source":"board","agent":"copilot","modelOverride":null,"reasoningOverride":null,"state":"Ready","activity":null,"priority":0,"attemptCount":0,"nextAttemptAt":null,"branch":null,"pullRequest":null,"checks":null,"checkConclusion":null,"usageSummary":null,"latestSessionEndReason":null,"createdAt":"2026-10-31T09:00:00Z","startedAt":null,"finishedAt":null}"#)
    .replacingOccurrences(of: "TASK41", with: #"{"id":"41","projectId":"7","issueNumber":9,"originMessageId":null,"title":"Synthetic task","request":"Synthetic request","source":"board","agent":"copilot","modelOverride":null,"reasoningOverride":null,"state":"NeedsAttention","activity":"Synthetic blocked","priority":0,"attemptCount":2,"nextAttemptAt":null,"branch":"copilot/work","pullRequest":null,"checks":null,"checkConclusion":null,"usageSummary":null,"latestSessionEndReason":"crashed","createdAt":"2026-10-31T07:00:00Z","startedAt":"2026-10-31T08:00:00Z","finishedAt":null}"#)

private let streamScenario = #"""
{
  "version": 1,
  "interactions": [
    {
      "method": "GET",
      "path": "/api/now/events",
      "stream": {
        "statusCode": 200,
        "headers": {"Content-Type": "text/event-stream"},
        "chunks": [{"text": "event: board\ndata: {\"projectId\":\"7\",\"version\":2}\n\n"}]
      }
    },
    {
      "method": "GET",
      "path": "/api/factory/tasks/41/events",
      "stream": {
        "statusCode": 200,
        "headers": {"Content-Type": "text/event-stream"},
        "chunks": [{
          "text": "event: ready\ndata: {}\n\nevent: task\nid: 6\ndata: {\"id\":\"6\",\"taskId\":\"41\",\"type\":\"state\",\"summary\":\"Synthetic update\",\"payload\":null,\"payloadTruncated\":false,\"source\":\"backend\",\"at\":\"2026-10-31T09:00:00Z\"}\n\n"
        }]
      }
    }
  ]
}
"""#
