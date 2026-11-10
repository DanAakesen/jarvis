import Foundation
import XCTest
@testable import JarvisCore

final class WatchTaskFlowTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_794_312_000)
    private let id = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
    private let zone = TimeZone(identifier: "Europe/Copenhagen")!

    func testModeSwitchingKeepsBothDraftsAndDoesNotAllocateSubmission() {
        var draft = WatchTaskDraft()
        draft.input = "Ring til tandlægen i morgen"
        draft.mode = .manual
        draft.fields = .init(text: "Call dentist", priority: .high, notes: "Ask about the next check-up.")
        draft.mode = .auto
        XCTAssertEqual(draft.input, "Ring til tandlægen i morgen")
        draft.mode = .manual
        XCTAssertEqual(draft.fields.text, "Call dentist")
        XCTAssertEqual(draft.fields.priority, .high)
        XCTAssertNil(draft.fields.due)
        XCTAssertNil(draft.fields.time)
        XCTAssertNil(WatchTaskSubmissionState().request)
    }

    func testFirstSaveCapturesIdentityTimeAndTimeZoneAndRetryIsByteIdentical() throws {
        var state = WatchTaskSubmissionState()
        let draft = autoDraft()
        let first = try state.begin(draft, now: now, timeZone: zone, makeID: { id })
        state.finish()
        let retry = try state.begin(draft, now: now.addingTimeInterval(86_400),
                                    timeZone: TimeZone(identifier: "America/New_York")!) {
            XCTFail("Retry must not allocate another identity")
            return UUID()
        }
        XCTAssertEqual(first, retry)
        XCTAssertEqual(try WatchCodec.encode(first), try WatchCodec.encode(retry))
        XCTAssertEqual(first.submissionId, id.uuidString.lowercased())
        XCTAssertEqual(first.timeZone, "Europe/Copenhagen")
        XCTAssertEqual(ISO8601DateFormatter().date(from: first.submittedAt), now)
        XCTAssertNil(first.fields, "Auto defaults are computed by the server, not when the editor opens")
    }

    func testDuplicateSendAndChangedRetryAreRejected() throws {
        var state = WatchTaskSubmissionState()
        var draft = autoDraft()
        _ = try state.begin(draft, now: now, timeZone: zone)
        XCTAssertThrowsError(try state.begin(draft)) {
            XCTAssertEqual($0 as? WatchTaskSubmissionError, .sending)
        }
        state.finish()
        draft.input += " with a changed title"
        XCTAssertThrowsError(try state.begin(draft)) {
            XCTAssertEqual($0 as? WatchTaskSubmissionError, .changedPayload)
        }
        XCTAssertFalse(state.sending)
        state.reviseRejectedDraft()
        XCTAssertNotNil(state.request, "An uncertain request cannot be replaced by a new task")
    }

    func testDefiniteRejectionRequiresExplicitRevisionAndKeepsContent() throws {
        var state = WatchTaskSubmissionState()
        let draft = autoDraft()
        let original = try state.begin(draft, now: now, timeZone: zone, makeID: { id })
        state.finish(rejectedWithoutSaving: true)
        XCTAssertTrue(state.canRevise)
        XCTAssertEqual(try state.begin(draft), original, "Retry before Edit draft must be immutable")
        state.finish(rejectedWithoutSaving: true)
        state.reviseRejectedDraft()
        XCTAssertNil(state.request)
        XCTAssertFalse(state.canRevise)
        XCTAssertEqual(draft.input, "Call dentist tomorrow at 9")
        let revised = try state.begin(draft, now: now.addingTimeInterval(30), timeZone: zone)
        XCTAssertNotEqual(revised.submissionId, original.submissionId)
    }

    func testManualDefaultRequestOmitsDateAndTimeButUsesNormalForLow() throws {
        var draft = WatchTaskDraft(); draft.mode = .manual
        draft.fields.text = "Call dentist"
        let value = WatchTaskCreateRequest(draft: draft, id: id, submittedAt: now, timeZone: zone)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        let fields = try XCTUnwrap(body["fields"] as? [String: Any])
        XCTAssertNil(body["input"])
        XCTAssertNil(fields["due"]); XCTAssertNil(fields["time"])
        XCTAssertEqual(fields["priority"] as? String, "normal")
        XCTAssertEqual(fields["scope"] as? String, "personal")
        XCTAssertEqual(VaultTask.Priority.normal.watchLabel, "Low")
        XCTAssertTrue(value.isValid)
    }

    func testInputValidationMatchesBackendUnicodeAndDateLimits() {
        var draft = autoDraft()
        draft.input = String(repeating: "ø", count: 2_000)
        XCTAssertNil(draft.validationMessage)
        draft.input += "ø"; XCTAssertNotNil(draft.validationMessage)
        for invalid in ["", "  ", "Task\u{0000}", "Task\u{200B}"] {
            draft.input = invalid; XCTAssertNotNil(draft.validationMessage)
        }
        draft.mode = .manual
        draft.fields.text = String(repeating: "🙂", count: 400)
        XCTAssertNil(draft.validationMessage)
        draft.fields.text += "🙂"; XCTAssertNotNil(draft.validationMessage)
        draft.fields = .init(text: "Call dentist", due: "2026-02-30", time: "09:00")
        XCTAssertNotNil(draft.validationMessage)
        draft.fields.due = "2026-11-10"; draft.fields.time = "24:00"
        XCTAssertNotNil(draft.validationMessage)
        draft.fields.time = "09:00"; XCTAssertNil(draft.validationMessage)
        draft.fields.due = nil; XCTAssertNotNil(draft.validationMessage)
        draft.fields.time = nil; draft.fields.notes = String(repeating: "a", count: 2_001)
        XCTAssertNotNil(draft.validationMessage)
    }

    func testEditBindsOriginalSourceAndVersionAndExplicitlyClearsOptionalDate() throws {
        let task = fixtureTask()
        let value = WatchTaskUpdateRequest(task: task,
            fields: .init(text: "Call dentist again", scope: .work, notes: "New notes"), timeZone: zone)
        XCTAssertTrue(value.isValid)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        XCTAssertEqual(body["path"] as? String, task.path)
        XCTAssertEqual(body["line"] as? Int, task.line)
        XCTAssertEqual(body["text"] as? String, task.text)
        XCTAssertEqual(body["version"] as? String, task.version)
        let fields = try XCTUnwrap(body["fields"] as? [String: Any])
        XCTAssertTrue(fields["due"] is NSNull)
        XCTAssertTrue(fields["time"] is NSNull)
        XCTAssertNil(fields["scope"], "Editing cannot silently move the original vault source")
        XCTAssertEqual(fields["text"] as? String, "Call dentist again")
        XCTAssertEqual(fields["notes"] as? String, "New notes")
    }

    func testTitleOnlyEditPreservesDateOnlyAndUndatedTasksWithoutAddingATimeZone() throws {
        for due in [nil, "2026-11-12"] {
            let task = VaultTask(id: String(repeating: "a", count: 64), text: "Existing task", done: false,
                dueDate: due, dueTime: nil, dueAt: nil, priority: .normal, path: "Personal/Inbox.md",
                line: 4, heading: nil, version: String(repeating: "b", count: 64))
            let edit = WatchTaskUpdateRequest(task: task,
                fields: .init(text: "Edited title", due: task.dueDate, time: task.dueTime), timeZone: nil)
            XCTAssertTrue(edit.isValid)
            XCTAssertEqual(edit.fields.due, due)
            XCTAssertNil(edit.fields.time)
            XCTAssertNil(edit.timeZone, "A title edit must not reinterpret a legacy due date in the Watch's current zone")
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit)) as? [String: Any])
            XCTAssertNil(object["timeZone"])
        }
    }

    func testTitleOnlyTimedLegacyEditIgnoresTravelTimeZoneUntilScheduleChanges() throws {
        let task = VaultTask(id: String(repeating: "a", count: 64), text: "Existing task", done: false,
            dueDate: "2026-11-12", dueTime: "09:00", dueAt: "2026-11-12T08:00:00Z",
            priority: .normal, path: "Personal/Inbox.md", line: 4, heading: nil,
            version: String(repeating: "b", count: 64))
        var fields = WatchTaskFields(text: "Edited title", due: task.dueDate, time: task.dueTime)
        let travelZone = TimeZone(identifier: "America/New_York")!
        let edit = WatchTaskUpdateRequest(task: task, fields: fields, timeZone: travelZone)
        XCTAssertNil(edit.timeZone)
        XCTAssertEqual(edit.fields.due, task.dueDate)
        XCTAssertEqual(edit.fields.time, task.dueTime)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit)) as? [String: Any])
        XCTAssertNil(object["timeZone"])
        fields.time = "10:00"
        let rescheduled = WatchTaskUpdateRequest(task: task, fields: fields, timeZone: travelZone)
        XCTAssertEqual(rescheduled.timeZone, "America/New_York")
    }

    func testTitleOnlyRepeatedHourEditKeepsOriginalZoneAndExactReturnedInstant() async throws {
        let original = VaultTask(id: String(repeating: "a", count: 64), text: "Call dentist", done: false,
            dueDate: "2026-10-25", dueTime: "02:30", dueAt: "2026-10-25T01:30:00.123Z",
            priority: .normal, path: "Personal/Inbox.md", line: 4, heading: nil,
            version: String(repeating: "b", count: 64), timeZone: "Europe/Copenhagen")
        let fields = WatchTaskFields(text: "Call dentist again", due: original.dueDate, time: original.dueTime)
        let edit = WatchTaskUpdateRequest(task: original, fields: fields,
                                          timeZone: TimeZone(identifier: "America/New_York")!)
        XCTAssertEqual(edit.timeZone, "Europe/Copenhagen")
        XCTAssertEqual(edit.fields.due, original.dueDate)
        XCTAssertEqual(edit.fields.time, original.dueTime)
        let returned = VaultTask(id: original.id, text: fields.text, done: false,
            dueDate: original.dueDate, dueTime: original.dueTime, dueAt: original.dueAt,
            priority: original.priority, path: original.path, line: original.line, heading: nil,
            version: String(repeating: "c", count: 64), timeZone: original.timeZone)
        let transport = TaskTransport([.response(.init(statusCode: 200, body: try JSONEncoder().encode(returned)))])
        let result = try await JarvisWatchTasksClient(client: http(transport)).update(edit)
        XCTAssertEqual(result.dueAt, "2026-10-25T01:30:00.123Z")
        XCTAssertEqual(result.timeZone, "Europe/Copenhagen")
    }

    func testOptionalTaskMetadataIsBackwardCompatibleAndRoundTrips() throws {
        let value = fixtureTask()
        let decoded = try JSONDecoder().decode(VaultTask.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(decoded.notes, value.notes); XCTAssertEqual(decoded.timeZone, value.timeZone)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        object.removeValue(forKey: "notes"); object.removeValue(forKey: "timeZone")
        let legacy = try JSONDecoder().decode(VaultTask.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertNil(legacy.notes); XCTAssertNil(legacy.timeZone)
        XCTAssertEqual(legacy.text, value.text)
    }

    func testReminderMetadataRoundTripsAndUnrelatedEditsPreserveRecordedOrUnknownPolicy() throws {
        for reminder in [nil, false, true] {
            let task = VaultTask(id: String(repeating: "a", count: 64), text: "Call dentist", done: false,
                dueDate: "2026-11-12", dueTime: "09:00", dueAt: "2026-11-12T08:00:00Z",
                priority: .high, path: "Personal/Inbox.md", line: 4, heading: nil,
                version: String(repeating: "b", count: 64), remindAtDue: reminder)
            let decoded = try JSONDecoder().decode(VaultTask.self, from: JSONEncoder().encode(task))
            XCTAssertEqual(decoded.remindAtDue, reminder)
            let edit = WatchTaskUpdateRequest(task: task,
                fields: .init(text: "Edited title", due: task.dueDate, time: task.dueTime, priority: task.priority),
                timeZone: nil)
            XCTAssertEqual(edit.fields.remindAtDue, reminder)
            XCTAssertTrue(edit.isValid)
            XCTAssertEqual(task.watchReminderLabel, reminder.map { $0 ? "At due time" : "Default timing" })
        }
    }

    func testClientPostsAndPatchesDedicatedRoutesWithoutAutomaticRetry() async throws {
        let task = fixtureTask()
        let transport = TaskTransport([
            .response(.init(statusCode: 200, body: try JSONEncoder().encode(task))),
            .response(.init(statusCode: 200, body: try JSONEncoder().encode(task)))
        ])
        let client = JarvisWatchTasksClient(client: try http(transport))
        let create = WatchTaskCreateRequest(draft: autoDraft(), id: id, submittedAt: now, timeZone: zone)
        let created = try await client.create(create)
        let edited = try await client.update(.init(task: task, fields: .init(text: "Changed title"), timeZone: zone))
        XCTAssertEqual(created, task); XCTAssertEqual(edited, task)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .patch])
        XCTAssertEqual(requests.map(\.url.path), ["/api/vault/watch-tasks", "/api/vault/watch-tasks"])
        XCTAssertEqual(requests.first?.timeout, .seconds(20))
        XCTAssertEqual(try JSONDecoder().decode(WatchTaskCreateRequest.self, from: XCTUnwrap(requests.first?.body)), create)
    }

    func testServerParseAndConflictDetailsSurviveWithoutGenericFailure() async throws {
        let errors: [(Int, String, String)] = [
            (400, "task_parse_failed", "The task could not be understood. Try different wording or use Manual."),
            (409, "task_conflict", "This task changed in the vault. Refresh the list.")
        ]
        let transport = TaskTransport(try errors.map { status, code, message in
            .response(.init(statusCode: status, body: try JSONSerialization.data(withJSONObject: [
                "error": message, "code": code, "outcomeUnknown": false, "retryable": false
            ])))
        })
        let client = JarvisWatchTasksClient(client: try http(transport))
        for (_, code, message) in errors {
            do { _ = try await client.create(createRequest()); XCTFail("Expected failure") }
            catch let JarvisWatchTasksClientError.failure(detail) {
                XCTAssertEqual(detail.code, code); XCTAssertEqual(detail.message, message)
                XCTAssertFalse(detail.outcomeUnknown)
            }
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 2)
    }

    func testParsingUnavailableCanReviseButUnknownSaveMustKeepOriginalRequest() async throws {
        let transport = TaskTransport([
            .response(.init(statusCode: 503, body: Data(#"{"error":"Automatic task parsing is unavailable. Use Manual or retry later.","outcomeUnknown":false}"#.utf8))),
            .response(.init(statusCode: 503, body: Data(#"{"error":"The task save outcome is unknown. Refresh tasks."}"#.utf8))),
            .failure(.timedOut)
        ])
        let client = JarvisWatchTasksClient(client: try http(transport))
        for expectedUnknown in [false, true, true] {
            do { _ = try await client.create(createRequest()); XCTFail("Expected failure") }
            catch let JarvisWatchTasksClientError.failure(detail) { XCTAssertEqual(detail.outcomeUnknown, expectedUnknown) }
        }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 3, "Mutation errors must not be automatically retried")
    }

    func testOversizedOrMalformedSuccessfulResponseNeverClaimsSaved() async throws {
        let transport = TaskTransport([
            .response(.init(statusCode: 200, body: Data(repeating: 32, count: WatchTaskValidation.responseBytes + 1))),
            .response(.init(statusCode: 200, body: Data(#"{"ok":true}"#.utf8)))
        ])
        let client = JarvisWatchTasksClient(client: try http(transport))
        for _ in 0..<2 {
            do { _ = try await client.create(createRequest()); XCTFail("Expected unknown outcome") }
            catch let JarvisWatchTasksClientError.failure(detail) { XCTAssertTrue(detail.outcomeUnknown) }
        }
    }

    func testEditResponseCannotClaimSuccessForAnotherVaultSource() async throws {
        let transport = TaskTransport([.response(.init(statusCode: 200, body: try JSONEncoder().encode(fixtureTask())))])
        let client = JarvisWatchTasksClient(client: try http(transport))
        let source = VaultTask(id: String(repeating: "c", count: 64), text: "Other task", done: false,
            dueDate: nil, dueTime: nil, dueAt: nil, priority: .normal, path: "Work/Inbox.md",
            line: 9, heading: nil, version: String(repeating: "d", count: 64))
        do {
            _ = try await client.update(.init(task: source, fields: .init(text: "Edited title"), timeZone: zone))
            XCTFail("Expected mismatched source to remain unconfirmed")
        } catch let JarvisWatchTasksClientError.failure(detail) { XCTAssertTrue(detail.outcomeUnknown) }
    }

    func testInvalidSubmissionNeverReachesTransportAndOwnerAuthIsPreserved() async throws {
        let transport = TaskTransport([.response(.init(statusCode: 403))])
        let client = JarvisWatchTasksClient(client: try http(transport))
        let invalid = WatchTaskCreateRequest(draft: WatchTaskDraft(), id: id, submittedAt: now, timeZone: zone)
        do { _ = try await client.create(invalid); XCTFail("Expected invalid request") }
        catch { XCTAssertEqual(error as? JarvisWatchTasksClientError, .invalidRequest) }
        do { _ = try await client.create(createRequest()); XCTFail("Expected owner failure") }
        catch { XCTAssertEqual(error as? JarvisClientError, .notOwner) }
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.count, 1)
    }

    func testUTCIdentityIsCompatibleWithBackendIANAValidation() {
        let value = WatchTaskCreateRequest(draft: autoDraft(), id: id, submittedAt: now,
                                          timeZone: TimeZone(secondsFromGMT: 0)!)
        XCTAssertEqual(value.timeZone, "UTC")
        XCTAssertTrue(value.isValid)
    }

    func testMutationEnvelopesBindSubmissionAndOriginalTaskIdentity() throws {
        let value = createRequest()
        var create = WatchRequest(action: .createWatchTask, data: try WatchCodec.encode(value), id: id)
        XCTAssertTrue(create.isValid)
        XCTAssertEqual(create.createWatchTaskRequest, value)
        create.id = UUID(); XCTAssertFalse(create.isValid)
        create.id = id; create.text = "Unexpected"; XCTAssertFalse(create.isValid)
        let task = fixtureTask()
        let edit = WatchTaskUpdateRequest(task: task, fields: .init(text: "Edited title"), timeZone: zone)
        var update = WatchRequest(action: .updateWatchTask, itemID: task.id, data: try WatchCodec.encode(edit))
        XCTAssertTrue(update.isValid)
        update.itemID = "arbitrary-source"; XCTAssertFalse(update.isValid)
        var complete = WatchRequest(action: .completeWatchTask, itemID: task.id,
                                    data: try WatchCodec.encode(task), flag: true)
        XCTAssertTrue(complete.isValid)
        complete.itemID = String(repeating: "c", count: 64); XCTAssertFalse(complete.isValid)
        complete.itemID = task.id; complete.flag = nil; XCTAssertFalse(complete.isValid)
    }

    func testTaskFailureWireRejectsUnboundedOrMalformedDetails() throws {
        let failure = WatchTaskMutationFailure(code: "task_parse_failed", message: "Use Manual.",
                                               retryable: false, outcomeUnknown: false)
        let reply = WatchReply(id: id, taskError: failure)
        let decoded = try JSONDecoder().decode(WatchReply.self, from: WatchCodec.encode(reply))
        XCTAssertEqual(decoded.taskError, failure)
        for invalid in [
            #"{"code":"invalid code","message":"Rejected","retryable":false,"outcomeUnknown":false}"#,
            #"{"code":"failed","message":"\u0000","retryable":false,"outcomeUnknown":false}"#,
            #"{"code":"failed","message":""#
                + String(repeating: "a", count: 1_004)
                + #"","retryable":false,"outcomeUnknown":false}"#
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(WatchTaskMutationFailure.self, from: Data(invalid.utf8)))
        }
    }

    func testTaskPagesKeepFullNotesAndOnlyFinishAfterAllPages() throws {
        var pages = WatchTaskPageCollection()
        let first = fixtureTask()
        let second = VaultTask(id: String(repeating: "c", count: 64), text: "Upcoming task", done: false,
            dueDate: "2026-11-12", dueTime: "14:00", dueAt: nil, priority: .medium,
            path: "Work/Inbox.md", line: 9, heading: "Tasks", version: String(repeating: "d", count: 64),
            notes: String(repeating: "ø", count: 2_000))
        try pages.append(.init(tasks: [first], totalCount: 2, offset: 0, nextOffset: 1,
                               dayStart: now, timeZoneID: zone.identifier))
        XCTAssertEqual(pages.nextOffset, 1)
        try pages.append(.init(tasks: [second], totalCount: 2, offset: 1, nextOffset: nil,
                               dayStart: now, timeZoneID: zone.identifier))
        XCTAssertNil(pages.nextOffset)
        XCTAssertEqual(pages.tasks, [first, second])
        XCTAssertEqual(pages.tasks.last?.notes, String(repeating: "ø", count: 2_000))
    }

    func testTaskPageChangesAndNonProgressingOrDuplicatePagesAreRejected() throws {
        let task = fixtureTask()
        var pages = WatchTaskPageCollection()
        try pages.append(.init(tasks: [task], totalCount: 2, offset: 0, nextOffset: 1,
                               dayStart: now, timeZoneID: zone.identifier))
        for invalid in [
            WatchTaskPage(tasks: [], totalCount: 2, offset: 1, nextOffset: 1, dayStart: now, timeZoneID: zone.identifier),
            .init(tasks: [task], totalCount: 2, offset: 1, nextOffset: nil, dayStart: now, timeZoneID: zone.identifier),
            .init(tasks: [], totalCount: 1, offset: 1, nextOffset: nil, dayStart: now, timeZoneID: zone.identifier),
            .init(tasks: [], totalCount: 2, offset: 1, nextOffset: nil, dayStart: now.addingTimeInterval(86_400), timeZoneID: zone.identifier)
        ] {
            var copy = pages
            XCTAssertThrowsError(try copy.append(invalid))
            XCTAssertEqual(copy.tasks, [task])
            XCTAssertEqual(copy.nextOffset, 1)
        }
    }

    func testEmptyTaskPageIsACompleteReadNotAPhoneFailure() throws {
        var pages = WatchTaskPageCollection()
        try pages.append(.init(tasks: [], totalCount: 0, offset: 0, nextOffset: nil,
                               dayStart: now, timeZoneID: zone.identifier))
        XCTAssertTrue(pages.tasks.isEmpty)
        XCTAssertNil(pages.nextOffset)
    }

    func testFiveHundredMaximumLengthTasksStayWholeAcrossByteBoundedPages() throws {
        let title = String(repeating: "𐐀", count: 400)
        let notes = String(repeating: "𐐀", count: 2_000)
        let tasks = (1...500).map { index in
            VaultTask(id: String(format: "%064x", index), text: title, done: false,
                dueDate: "2026-11-12", dueTime: nil, dueAt: nil, priority: .normal,
                path: "Personal/Inbox.md", line: index, heading: nil,
                version: String(repeating: "a", count: 64), notes: notes)
        }
        var pages = WatchTaskPageCollection()
        for offset in stride(from: 0, to: tasks.count, by: 3) {
            let batch = Array(tasks.dropFirst(offset).prefix(3))
            let end = offset + batch.count
            let page = WatchTaskPage(tasks: batch, totalCount: tasks.count, offset: offset,
                nextOffset: end < tasks.count ? end : nil, dayStart: now, timeZoneID: zone.identifier)
            XCTAssertLessThanOrEqual(try WatchCodec.encode(page).count, WatchLimits.payloadBytes)
            try pages.append(page)
        }
        XCTAssertNil(pages.nextOffset)
        XCTAssertEqual(pages.tasks, tasks)
        XCTAssertTrue(pages.tasks.allSatisfy { $0.text == title && $0.notes == notes })
    }

    private func autoDraft() -> WatchTaskDraft {
        var value = WatchTaskDraft(); value.input = "Call dentist tomorrow at 9"; return value
    }
    private func createRequest() -> WatchTaskCreateRequest {
        .init(draft: autoDraft(), id: id, submittedAt: now, timeZone: zone)
    }
    private func fixtureTask() -> VaultTask {
        .init(id: String(repeating: "a", count: 64), text: "Call dentist", done: false,
              dueDate: "2026-11-10", dueTime: "17:00", dueAt: "2026-11-10T16:00:00.000Z",
              priority: .normal, path: "Personal/Inbox.md", line: 4, heading: "Tasks",
              version: String(repeating: "b", count: 64), notes: "Ask about the next check-up.",
              timeZone: "Europe/Copenhagen")
    }
    private func http(_ transport: TaskTransport) throws -> JarvisClient {
        try .init(configuration: .init(baseURL: URL(string: "https://fixture.invalid/api")!,
                                       retryPolicy: .init(maximumRetries: 2, delay: .zero)),
                  transport: transport, tokenStore: TaskTokenStore(), accessTokenProvider: TaskTokenProvider())
    }
}

private actor TaskTransport: HTTPTransport {
    enum Stub: Sendable { case response(HTTPResponse), failure(HTTPTransportFailure) }
    var stubs: [Stub]
    var requests: [HTTPRequest] = []
    init(_ stubs: [Stub]) { self.stubs = stubs }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !stubs.isEmpty else { throw HTTPTransportFailure.network }
        switch stubs.removeFirst() {
        case .response(let response): return response
        case .failure(let error): throw error
        }
    }
    func recordedRequests() -> [HTTPRequest] { requests }
}
private actor TaskTokenStore: TokenStore {
    func read() async throws -> String? { "watch-task-fixture-session" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}
private actor TaskTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "watch-task-fixture-owner" }
    func requestSignIn() async {}
}
