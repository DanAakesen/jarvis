import Foundation
import XCTest
@testable import JarvisCore

// Minimal guard set: session token storage, auth failure mapping, and the HTTP transport contract.
final class JarvisClientTransportTests: XCTestCase {
    func testLocationObservationsAndPermissionUpdatesReachSettingsTransport() async throws {
        let fix = try XCTUnwrap(DeviceLocationSettings.patch(city: "Copenhagen", latitude: 55.676, longitude: 12.568))
        let patches = try [fix] + ["not_determined", "denied", "restricted"].map {
            try XCTUnwrap(DeviceLocationSettings.permissionPatch($0))
        }
        let response = jsonResponse(status: 200, body: ["settings": [:], "options": [:], "credentials": []])
        let transport = FakeHTTPTransport(patches.map { _ in .response(response) })
        let settings = JarvisSettingsClient(client: try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "js.fixture")))
        for patch in patches { _ = try await settings.saveSettings(patch) }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, patches.count)
        for (request, patch) in zip(requests, patches) {
            XCTAssertEqual(request.method, .patch)
            XCTAssertEqual(request.url.path, "/api/settings")
            XCTAssertEqual(try JSONDecoder().decode(JarvisSettingsPatch.self, from: XCTUnwrap(request.body)), patch)
        }
    }

    func testOwnerCanReadEditAndReopenBothTargetPages() async throws {
        for training in [true, false] {
            let kind = training ? "training" : "nutrition"
            let keys = training ? ["gymSessionsPerWeek", "runSessionsPerWeek", "dailySteps"] : ["deficitKcal", "restingKcal", "proteinGrams"]
            let values = training ? [(0, 21, "sessions/week"), (0, 21, "sessions/week"), (0, 100_000, "steps/day")] :
                [(0, 2000, "kcal"), (1000, 4000, "kcal"), (30, 400, "g")]
            let bounds: [String: [String: Any]] = Dictionary(uniqueKeysWithValues: zip(keys, values).map { key, value in
                (key, ["label": key, "min": value.0, "max": value.1, "unit": value.2])
            })
            var targets: [String: Any] = Dictionary(uniqueKeysWithValues: keys.map { ($0, NSNull()) })
            let empty = jsonResponse(status: 200, body: ["targets": targets, "bounds": bounds, "missing": keys, "updatedAt": NSNull()])
            targets[keys[0]] = 0
            let saved = jsonResponse(status: 200, body: ["targets": targets, "bounds": bounds, "missing": Array(keys.dropFirst()), "updatedAt": "2026-11-22T18:05:43.917Z"])
            let transport = FakeHTTPTransport([.response(empty), .response(saved), .response(saved)])
            let settings = JarvisSettingsClient(client: try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "js.fixture")))
            let initial = training ? try await settings.loadTrainingTargets() : try await settings.loadNutritionTargets()
            let changes: [String: Int?] = [keys[0]: 0]
            let written = training ? try await settings.saveTrainingTargets(changes, bounds: initial.bounds) :
                try await settings.saveNutritionTargets(changes, bounds: initial.bounds)
            let reopened = training ? try await settings.loadTrainingTargets() : try await settings.loadNutritionTargets()
            XCTAssertEqual(initial.missing, keys)
            XCTAssertEqual(written, reopened)
            XCTAssertEqual(reopened.targets[keys[0]], .integer(0))
            let requests = await transport.recordedRequests()
            XCTAssertEqual(requests.map(\.method), [.get, .patch, .get])
            XCTAssertTrue(requests.allSatisfy { $0.url.path == "/api/health/\(kind)-targets" && $0.headers["Authorization"] == authorization("js.fixture") })
            XCTAssertEqual(try JSONDecoder().decode([String: Int].self, from: XCTUnwrap(requests[1].body)), [keys[0]: 0])
        }
    }

    func testTargetPagesDistinguishEmptyWebAndMalformedRepliesFromRouteErrors() async throws {
        let cases: [(HTTPResponse, JarvisSettingsClientError)] = [
            (HTTPResponse(statusCode: 200), .emptyResponse),
            (HTTPResponse(statusCode: 200, headers: ["content-type": "text/html; charset=utf-8"],
                          body: Data("<!doctype html>".utf8)), .webPageResponse),
            (jsonResponse(status: 200, body: ["targets": [:]]), .invalidResponse),
            (HTTPResponse(statusCode: 404), .notFound),
        ]
        for (reply, expected) in cases {
            let transport = FakeHTTPTransport([.response(reply), .response(reply)])
            let settings = JarvisSettingsClient(client: try makeClient(transport: transport))
            for isTraining in [true, false] {
                do {
                    _ = isTraining ? try await settings.loadTrainingTargets() : try await settings.loadNutritionTargets()
                    XCTFail("Expected target load failure")
                } catch {
                    XCTAssertEqual(error as? JarvisSettingsClientError, expected)
                }
            }
        }
    }

    func testNoteSwipeThresholds() {
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 71), .none)
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 72), .pin)
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 159), .pin)
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 160), .delete)
    }

    func testPinnedRowSwipeUnpinsAtAnyLengthAndNeverDeletes() {
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 71, allowsDelete: false), .none)
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 72, allowsDelete: false), .pin)
        XCTAssertEqual(JarvisNotesLogic.swipeAction(distance: 400, allowsDelete: false), .pin)
    }

    func testNoteDeletionUsesExactVersionAndDoesNotRetryUnknownOutcome() async throws {
        let transport = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 204)),
            .failure(.network),
        ])
        let client = JarvisNotesClient(client: try makeClient(transport: transport))
        let sha = String(repeating: "a", count: 40)
        try await client.deleteNote(path: "Personal/example.md", sha: sha)
        do {
            try await client.deleteNote(path: "Personal/example.md", sha: sha)
            XCTFail("Expected unknown outcome")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .writeOutcomeUnknown)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].method, .delete)
        XCTAssertEqual(requests[0].url.path, "/api/notes/note")
        let body = try XCTUnwrap(requests[0].body)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: body) as? [String: String],
                       ["path": "Personal/example.md", "sha": sha])
    }

    func testSaveConflictCarriesTheLatestVersionAndTaskDeleteSendsExactIdentity() async throws {
        let latest = String(repeating: "c", count: 40)
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 409, body: ["error": "changed", "currentSha": latest, "content": "# Newer"])),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let client = JarvisNotesClient(client: try makeClient(transport: transport))
        do {
            _ = try await client.saveNote(path: "Personal/example.md", content: "# Mine", sha: String(repeating: "a", count: 40))
            XCTFail("Expected conflict")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .noteConflict(currentSha: latest, content: "# Newer"))
        }
        let task = VaultTask(
            id: String(repeating: "1", count: 64), text: "Pay rent", done: false, dueDate: nil, dueTime: nil, dueAt: nil,
            priority: .normal, path: "Personal/Inbox.md", line: 3, heading: nil, version: String(repeating: "2", count: 64)
        )
        try await client.deleteTask(task)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests[1].method, .delete)
        XCTAssertEqual(requests[1].url.path, "/api/vault/tasks")
        let body = try XCTUnwrap(requests[1].body)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["line"] as? Int, 3)
        XCTAssertEqual(object["text"] as? String, "Pay rent")
    }

    func testNoteDeletionRejectsUnsafePathAndReportsConflict() async throws {
        let transport = FakeHTTPTransport([.response(jsonResponse(status: 409, body: ["error": "changed"]))])
        let client = JarvisNotesClient(client: try makeClient(transport: transport))
        let sha = String(repeating: "a", count: 40)
        do {
            try await client.deleteNote(path: ".hidden/example.md", sha: sha)
            XCTFail("Expected invalid path")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .invalidRequest)
        }
        do {
            try await client.deleteNote(path: "example.md", sha: sha)
            XCTFail("Expected conflict")
        } catch {
            guard case .noteConflict = error as? JarvisNotesClientError else {
                return XCTFail("Expected note conflict, got \(error)")
            }
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
    }

    func testFolderOrderIsReadAndReplacedPerParentThroughTheBackend() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: ["orders": [
                ["parent": "", "folders": ["Work", "Personal"]], ["parent": "Work", "folders": ["Work/Projects"]],
            ]])),
            .response(jsonResponse(status: 200, body: ["parent": "", "folders": ["Personal", "Work"]])),
            .response(jsonResponse(status: 200, body: ["orders": [["parent": "", "folders": ["Work", "Work"]]]])),
        ])
        let client = JarvisNotesClient(client: try makeClient(transport: transport))
        let order = try await client.folderOrder()
        XCTAssertEqual(order.byParent, ["": ["Work", "Personal"], "Work": ["Work/Projects"]])
        try await client.setFolderOrder(parent: "", folders: ["Personal", "Work"])
        do {
            _ = try await client.folderOrder()
            XCTFail("Expected an invalid response")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .invalidResponse)
        }
        do {
            try await client.setFolderOrder(parent: "Work", folders: ["Personal"])
            XCTFail("Expected an invalid request")
        } catch {
            XCTAssertEqual(error as? JarvisNotesClientError, .invalidRequest)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 3)
        XCTAssertEqual(requests[0].method, .get)
        XCTAssertEqual(requests[0].url.path, "/api/notes/folder-order")
        XCTAssertEqual(requests[1].method, .put)
        XCTAssertEqual(requests[1].url.path, "/api/notes/folder-order")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests[1].body)) as? [String: Any])
        XCTAssertEqual(body["parent"] as? String, "")
        XCTAssertEqual(body["folders"] as? [String], ["Personal", "Work"])
    }

    func testSessionLifecycleUsesBearerTokensAndPersistsSessionToken() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 201, body: sessionJSON)),
            .response(HTTPResponse(statusCode: 200, body: Data("[]".utf8))),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let tokenStore = FakeTokenStore()
        let provider = FakeAccessTokenProvider(token: "entra.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: tokenStore, provider: provider)

        let session = try await client.createOwnerSession(deviceLabel: "Synthetic phone")
        _ = try await client.listTools()
        try await client.revokeCurrentSession()

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .get, .delete])
        XCTAssertEqual(requests.map { $0.headers["Authorization"] }, [
            authorization("entra.fixture.token"),
            authorization("session.fixture.token"),
            authorization("session.fixture.token"),
        ])
        XCTAssertEqual(session.sessionId, "session-fixture")
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testRevokesCreatedSessionWhenTokenCannotBeStored() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 201, body: sessionJSON)),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let tokenStore = FakeTokenStore(failWrites: true)
        let client = try makeClient(transport: transport, tokenStore: tokenStore)

        do {
            _ = try await client.createOwnerSession()
            XCTFail("Expected token-store error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .tokenStoreFailure)
        }

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .delete])
        XCTAssertEqual(requests[1].headers["Authorization"], authorization("session.fixture.token"))
    }

    func testRevokeAllSessionsUsesSharedRouteAndClearsToken() async throws {
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: ["revoked": 3])),
        ])
        let tokenStore = FakeTokenStore(token: "session.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: tokenStore)

        let response = try await client.revokeAllSessions()

        XCTAssertEqual(response.revoked, 3)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .delete)
        XCTAssertEqual(request.url.path, "/api/auth/sessions")
        let storedToken = try await tokenStore.read()
        XCTAssertNil(storedToken)
    }

    func testMapsAuthenticationAndAuthorizationFailures() async throws {
        let unauthorized = FakeHTTPTransport([.response(HTTPResponse(statusCode: 401))])
        let tokenStore = FakeTokenStore(token: "session.fixture.token")
        let provider = FakeAccessTokenProvider(token: "entra.fixture.token")
        let unauthorizedClient = try makeClient(
            transport: unauthorized,
            tokenStore: tokenStore,
            provider: provider
        )

        do {
            _ = try await unauthorizedClient.listTools()
            XCTFail("Expected sign-in-required error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .signInRequired)
        }
        let storedToken = try await tokenStore.read()
        let signInRequests = await provider.signInRequests()
        XCTAssertNil(storedToken)
        XCTAssertEqual(signInRequests, 1)

        let forbidden = FakeHTTPTransport([.response(HTTPResponse(statusCode: 403))])
        let forbiddenClient = try makeClient(transport: forbidden)
        do {
            _ = try await forbiddenClient.listTools()
            XCTFail("Expected not-owner error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .notOwner)
        }
    }

    func testRetriesTransientIdempotentRequestWithinBound() async throws {
        let transport = FakeHTTPTransport([
            .response(HTTPResponse(statusCode: 503)),
            .response(HTTPResponse(statusCode: 503)),
            .response(HTTPResponse(statusCode: 200, body: Data("[]".utf8))),
        ])
        let client = try makeClient(
            transport: transport,
            retryPolicy: RetryPolicy(maximumRetries: 2, delay: .zero, maximumDelay: .zero)
        )

        let tools = try await client.listTools()
        let retryRequests = await transport.recordedRequests()
        XCTAssertTrue(tools.isEmpty)
        XCTAssertEqual(retryRequests.count, 3)
    }

    func testMapsNetworkAndTimeoutFailuresSeparately() async throws {
        let network = FakeHTTPTransport([.failure(.network)])
        let networkClient = try makeClient(transport: network, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await networkClient.listTools()
            XCTFail("Expected network error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .networkFailure)
        }

        let timeout = FakeHTTPTransport([.failure(.timedOut)])
        let timeoutClient = try makeClient(transport: timeout, retryPolicy: RetryPolicy(maximumRetries: 0))
        do {
            _ = try await timeoutClient.listTools()
            XCTFail("Expected timeout error")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .timedOut)
        }
    }

    func testCancellationPropagatesToTransport() async throws {
        let transport = FakeHTTPTransport([.suspend])
        let client = try makeClient(transport: transport)
        let task = Task { try await client.listTools() }

        await transport.waitUntilStarted()
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            XCTAssertTrue(true)
        }
    }

    func testWatchCredentialsUseOwnerAuthenticationWithoutReplacingOwnerToken() async throws {
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(900))
        let transport = FakeHTTPTransport([
            .response(jsonResponse(status: 200, body: ["credential": "watch.fixture.opaque", "expiresAt": expiry])),
            .response(HTTPResponse(statusCode: 204)),
        ])
        let store = FakeTokenStore(token: "session.fixture.token")
        let client = try makeClient(transport: transport, tokenStore: store,
                                    baseURL: URL(string: "https://api.example.invalid")!)
        let credential = try await client.provisionWatchCredential()
        try await client.revokeWatchCredentials()
        XCTAssertEqual(credential.token, "watch.fixture.opaque")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .delete])
        XCTAssertEqual(requests.map(\.url.path), ["/voice/watch/credential", "/voice/watch/credential"])
        XCTAssertTrue(requests.allSatisfy { $0.headers["Authorization"] == authorization("session.fixture.token") })
        let stored = try await store.read()
        XCTAssertEqual(stored, "session.fixture.token")
    }

    func testWatchCredentialProvisioningNeverResendsAfterNetworkFailure() async throws {
        let transport = FakeHTTPTransport([.failure(.network)])
        let client = try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "session.fixture.token"))
        do {
            _ = try await client.provisionWatchCredential()
            XCTFail("Expected failure")
        } catch {
            XCTAssertEqual(error as? JarvisClientError, .networkFailure)
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
    }

    func testWatchRevocationFailureIsNotReportedAsSuccess() async throws {
        let transport = FakeHTTPTransport([.response(HTTPResponse(statusCode: 503))])
        let client = try makeClient(transport: transport, tokenStore: FakeTokenStore(token: "session.fixture.token"))
        do {
            try await client.revokeWatchCredentials()
            XCTFail("Expected unconfirmed revocation")
        } catch { XCTAssertEqual(error as? JarvisClientError, .serviceUnavailable) }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.method, .delete)
    }

    func testReopeningWarmPersonalFolderShowsAnOutsideWriteWithoutPullToRefresh() async throws {
        let item = ["path": "Personal/Test 2.md", "title": "Test 2", "folder": "Personal",
                    "directory": "Personal", "updatedAt": "2026-11-22T10:00:00.000Z"]
        func page(_ items: [[String: String]]) -> HTTPResponse {
            jsonResponse(status: 200, body: ["notes": items, "limit": 50, "offset": 0, "hasMore": false])
        }
        let transport = FakeHTTPTransport([.response(page([])), .response(page([item]))])
        let notes = JarvisNotesClient(client: try makeClient(transport: transport))
        let now = Date(timeIntervalSince1970: 1_795_344_000)
        let cache = JarvisCache(storage: JarvisInMemoryCacheStorage(), now: { now })
        await cache.bind(account: "fixture-owner")
        let folder = notes.directoryRepository(cache: cache, directory: "Personal")
        let before = await folder.resolve()
        XCTAssertEqual(before.value?.notes, [])
        var showedCache = false
        var freshTitles: [String]?
        // The two opens share the same clock and warm cache; the only change was in the vault.
        for await update in folder.updates() {
            switch update {
            case .cached(let page, _): showedCache = page.notes.isEmpty
            case .fresh(let page): freshTitles = page.notes.map(\.title)
            default: break
            }
        }
        XCTAssertTrue(showedCache)
        XCTAssertEqual(freshTitles, ["Test 2"])
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 2)
        XCTAssertTrue(requests.allSatisfy { $0.url.query?.contains("sort=updated") == true })
    }

    func testPullToRefreshReplacesWarmRootAndPersonalPagesWithoutValidators() async throws {
        func page(path: String, title: String, directory: String) -> HTTPResponse {
            jsonResponse(status: 200, body: [
                "notes": [["path": path, "title": title, "folder": directory,
                           "directory": directory, "updatedAt": "2026-11-22T10:01:00.000Z"]],
                "limit": 50, "offset": 0, "hasMore": false
            ])
        }
        let transport = FakeHTTPTransport([
            .response(page(path: "New root.md", title: "New root", directory: "")),
            .response(page(path: "Personal/Build 122.md", title: "Build 122", directory: "Personal"))
        ])
        let notes = JarvisNotesClient(client: try makeClient(transport: transport))
        let now = Date(timeIntervalSince1970: 1_795_344_000)
        let account = "fixture-owner"
        let storage = JarvisInMemoryCacheStorage()
        let cache = JarvisCache(storage: storage, now: { now })
        await cache.bind(account: account)
        for (directory, freshTitle) in [("", "New root"), ("Personal", "Build 122")] {
            let oldPath = directory.isEmpty ? "Old.md" : "\(directory)/Old.md"
            let oldPage = page(path: oldPath, title: "Old", directory: directory)
            await storage.write(JarvisCacheEntry(data: oldPage.body, fetchedAt: now, validator: "\"old-page\""),
                                account: account, key: JarvisRepositoryKind.notes.key(scope: "dir:\(directory)"))
            let repository = notes.directoryRepository(cache: cache, directory: directory)
            let cached = await repository.cachedValue()
            XCTAssertEqual(cached?.notes.map(\.title), ["Old"])
            let refreshed = await repository.resolve(force: true)
            XCTAssertNil(refreshed.error)
            XCTAssertEqual(refreshed.value?.notes.map(\.title), [freshTitle])
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 2)
        for (request, directory) in zip(requests, ["", "Personal"]) {
            XCTAssertEqual(request.method, .get)
            XCTAssertEqual(request.url.path, "/api/notes")
            XCTAssertEqual(request.headers["Cache-Control"], "no-cache")
            XCTAssertNil(request.headers["If-None-Match"])
            let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(query?.first(where: { $0.name == "directory" })?.value, directory)
            XCTAssertTrue(query?.contains(URLQueryItem(name: "sort", value: "updated")) == true)
            XCTAssertTrue(query?.contains(URLQueryItem(name: "offset", value: "0")) == true)
        }
    }

    func testPinSummariesResolveByExactPathWithoutUsingGraphOrFolderPages() async throws {
        let path = "Work/Events/old-title.md"
        let item = ["path": path, "title": "New > schedule", "folder": "Work",
                    "directory": "Work/Events", "updatedAt": "2026-11-22T10:00:00.000Z"]
        let other = ["path": "Personal/other.md", "title": "Other", "folder": "Personal",
                     "directory": "Personal", "updatedAt": "2026-11-22T10:00:00.000Z"]
        let transport = FakeHTTPTransport([.response(jsonResponse(status: 200, body: ["notes": [other, item]]))])
        let notes = JarvisNotesClient(client: try makeClient(transport: transport))
        let missing = "Work/Events/missing.md"
        let summaries = try await notes.noteSummaries(paths: [path, missing, path])
        XCTAssertEqual(summaries.map(\.path), [path])
        XCTAssertEqual(summaries.map(\.title), ["New > schedule"])
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/api/notes/summaries")
        let body = try JSONDecoder().decode([String: [String]].self, from: XCTUnwrap(request.body))
        XCTAssertEqual(body["paths"], [path, missing])
    }

    private var sessionJSON: [String: String] {
        [
            "sessionId": "session-fixture",
            "token": "session.fixture.token",
            "idleExpiresAt": "2030-01-01T00:00:00.000Z",
            "absoluteExpiresAt": "2030-01-20T00:00:00.000Z",
        ]
    }

    func testGymLogNotesLiveOnlyUnderPersonalHealth() async throws {
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(JarvisGymLogNote.parse(path: "Personal/Health/Gym log/2026-11-16-1000-legs.md", timeZone: utc)?.session, .legs)
        XCTAssertNil(JarvisGymLogNote.parse(path: "Personal/Gym log/2026-11-16-1000-legs.md", timeZone: utc))

        let transport = FakeHTTPTransport([.response(jsonResponse(status: 201, body: [
            "path": "Personal/Health/Gym log/2026-11-16-1000-legs.md", "commit": String(repeating: "c", count: 40),
            "url": "https://github.com/example/vault/blob/master/note.md",
        ]))])
        let store = JarvisVaultGymLogStore(client: JarvisNotesClient(client: try makeClient(transport: transport)), timeZone: utc)
        try await store.save(JarvisGymLogEntry(performedAt: Date(timeIntervalSince1970: 1_794_823_200), session: .legs))
        let requests = await transport.recordedRequests()
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(requests.first?.body)) as? [String: String])
        XCTAssertEqual(body["path"], "Personal/Health/Gym log/2026-11-16-1000-legs.md")
    }

    private func makeClient(
        transport: FakeHTTPTransport,
        tokenStore: FakeTokenStore = FakeTokenStore(),
        provider: FakeAccessTokenProvider = FakeAccessTokenProvider(token: "entra.fixture.token"),
        retryPolicy: RetryPolicy = RetryPolicy(),
        baseURL: URL = URL(string: "https://api.example.invalid/api")!
    ) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: baseURL,
                retryPolicy: retryPolicy
            ),
            transport: transport,
            tokenStore: tokenStore,
            accessTokenProvider: provider
        )
    }

    private func jsonResponse(status: Int, body: Any) -> HTTPResponse {
        HTTPResponse(
            statusCode: status,
            body: try! JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed])
        )
    }

    private func authorization(_ token: String) -> String {
        ["Bear", "er"].joined() + " " + token
    }
}

private actor FakeHTTPTransport: HTTPTransport {
    enum Stub: Sendable {
        case response(HTTPResponse)
        case failure(HTTPTransportFailure)
        case suspend
    }

    private var stubs: [Stub]
    private var requests: [HTTPRequest] = []
    private var hasStarted = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    init(_ stubs: [Stub]) {
        self.stubs = stubs
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        hasStarted = true
        startWaiters.forEach { $0.resume() }
        startWaiters.removeAll()
        guard !stubs.isEmpty else { return HTTPResponse(statusCode: 200, body: Data("[]".utf8)) }
        switch stubs.removeFirst() {
        case .response(let response):
            return response
        case .failure(let failure):
            throw failure
        case .suspend:
            try await Task.sleep(for: .seconds(60))
            throw HTTPTransportFailure.network
        }
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { startWaiters.append($0) }
    }
}

private actor FakeTokenStore: TokenStore {
    private var token: String?
    private let failWrites: Bool

    init(token: String? = nil, failWrites: Bool = false) {
        self.token = token
        self.failWrites = failWrites
    }

    func read() async throws -> String? {
        token
    }

    func write(_ token: String) async throws {
        if failWrites { throw FakeTokenStoreError.writeFailed }
        self.token = token
    }

    func delete() async throws {
        token = nil
    }
}

private enum FakeTokenStoreError: Error {
    case writeFailed
}

private actor FakeAccessTokenProvider: AccessTokenProvider {
    private let token: String
    private let failure: JarvisClientError?
    private var signInsRequested = 0

    init(token: String, failure: JarvisClientError? = nil) {
        self.token = token
        self.failure = failure
    }

    func currentToken(for request: HTTPRequest) async throws -> String {
        if let failure { throw failure }
        return token
    }

    func requestSignIn() async {
        signInsRequested += 1
    }

    func signInRequests() -> Int {
        signInsRequested
    }
}
