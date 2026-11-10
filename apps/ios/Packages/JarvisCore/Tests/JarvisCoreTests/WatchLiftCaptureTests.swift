import Foundation
import XCTest
@testable import JarvisCore

final class WatchLiftCaptureTests: XCTestCase {
    func testTypingAndDictatingOnlyEditUntilExplicitSave() {
        var draft = WatchLiftCaptureDraft()
        let key = draft.idempotencyKey
        XCTAssertTrue(draft.updateText("Bench press"))
        XCTAssertTrue(draft.updateText(draft.text + ", 80 kg, 4 reps, 3 sets"))
        XCTAssertEqual(draft.phase, .editing)
        XCTAssertNil(draft.requestText)
        XCTAssertEqual(draft.idempotencyKey, key)
        XCTAssertTrue(draft.canSubmit)
    }

    func testDisconnectedSaveDoesNotQueueAndReconnectDoesNotSubmit() {
        var draft = WatchLiftCaptureDraft(text: "Bench press, 80 kg, 4 reps")
        XCTAssertNil(draft.beginSubmission(reachable: false))
        XCTAssertEqual(draft.phase, .editing)
        XCTAssertNil(draft.requestText)
        XCTAssertEqual(draft.text, "Bench press, 80 kg, 4 reps")
        XCTAssertTrue(draft.canSubmit)
    }

    func testUncertainRetryLocksExactTextAndStableOperationAcrossProcessDeath() throws {
        var draft = WatchLiftCaptureDraft(text: " Bench press, 80 kg, 4 reps ")
        let first = try XCTUnwrap(draft.beginSubmission(reachable: true))
        XCTAssertNil(draft.beginSubmission(reachable: true), "Do not overlap writes")
        XCTAssertFalse(draft.updateText("Squat, 100 kg, 5 reps"))
        var restored = try WatchLiftCaptureDraft.restore(from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.phase, .uncertain)
        XCTAssertFalse(restored.updateText("Squat, 100 kg, 5 reps"))
        XCTAssertEqual(restored.beginSubmission(reachable: true), first)
        restored.failSubmission()
        let disconnected = try WatchLiftCaptureDraft.restore(from: JSONEncoder().encode(restored))
        XCTAssertEqual(disconnected.text, first.text)
        XCTAssertEqual(disconnected.idempotencyKey, first.idempotencyKey)
    }

    func testNeedsDetailsPreservesOriginalAndAllowsCorrectionWithSameKey() throws {
        var draft = WatchLiftCaptureDraft(text: "Bench press, 80 kg")
        let first = try XCTUnwrap(draft.beginSubmission(reachable: true))
        draft.receive(.needsDetails(question: "How many reps?"))
        XCTAssertEqual(draft.text, first.text)
        XCTAssertEqual(draft.result, .needsDetails(question: "How many reps?"))
        var restored = try WatchLiftCaptureDraft.restore(from: JSONEncoder().encode(draft))
        XCTAssertTrue(restored.canEdit)
        XCTAssertTrue(restored.updateText(restored.text + ", 4 reps"))
        let clarified = try XCTUnwrap(restored.beginSubmission(reachable: true))
        XCTAssertEqual(clarified.idempotencyKey, first.idempotencyKey)
        XCTAssertEqual(clarified.text, first.text + ", 4 reps")
        restored.failSubmission()
        XCTAssertFalse(restored.updateText("Different lift"))
        restored.startAnother()
        XCTAssertEqual(restored.idempotencyKey, first.idempotencyKey, "An uncertain operation cannot be abandoned for a fresh write")
        XCTAssertEqual(restored.beginSubmission(reachable: true), clarified)
    }

    func testSavedReceiptUsesReturnedRecordAndRequiresExplicitNewOperation() throws {
        var draft = WatchLiftCaptureDraft(text: "bench 80kg x4")
        let request = try XCTUnwrap(draft.beginSubmission(reachable: true))
        let result = try savedResult()
        draft.receive(result)
        XCTAssertEqual(draft.result, result)
        XCTAssertEqual(draft.text, request.text)
        XCTAssertFalse(draft.canEdit)
        XCTAssertNil(draft.beginSubmission(reachable: true))
        let restored = try WatchLiftCaptureDraft.restore(from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.phase, .saved)
        XCTAssertEqual(restored.result, result)
        draft.startAnother()
        XCTAssertNotEqual(draft.idempotencyKey, request.idempotencyKey)
        XCTAssertEqual(draft.text, "")
        XCTAssertEqual(draft.phase, .editing)
    }

    func testDeletedReceiptRestoresTerminalAndRequiresExplicitNewOperation() throws {
        var draft = WatchLiftCaptureDraft(text: "Bench press, 80 kg, 4 reps")
        let original = try XCTUnwrap(draft.beginSubmission(reachable: true))
        draft.failSubmission()
        XCTAssertEqual(draft.beginSubmission(reachable: true), original)
        draft.receive(.deleted)
        XCTAssertEqual(draft.phase, .deleted)
        XCTAssertFalse(draft.canSubmit)
        XCTAssertFalse(draft.canEdit)
        XCTAssertFalse(draft.updateText("Different lift"))
        XCTAssertNil(draft.beginSubmission(reachable: true))
        var restored = try WatchLiftCaptureDraft.restore(from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored.phase, .deleted)
        XCTAssertEqual(restored.result, .deleted)
        XCTAssertEqual(restored.idempotencyKey, original.idempotencyKey)
        XCTAssertEqual(restored.text, original.text)
        XCTAssertEqual(restored.requestText, original.text)
        restored.startAnother()
        XCTAssertEqual(restored.phase, .editing)
        XCTAssertNotEqual(restored.idempotencyKey, original.idempotencyKey)
        XCTAssertEqual(restored.text, "")
        XCTAssertNil(restored.requestText)
        XCTAssertNil(restored.result)
    }

    @MainActor func testDeletedStoreSurvivesProcessRestartUntilExplicitStartAnother() throws {
        let directory = testArtifactDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("capture.json")
        let store = try WatchLiftCaptureStore(fileURL: url)
        try store.updateText("Bench press, 80 kg, 4 reps")
        let original = try XCTUnwrap(store.beginSubmission(reachable: true))
        try store.receive(.deleted)
        let recovered = try WatchLiftCaptureStore(fileURL: url)
        XCTAssertEqual(recovered.draft.phase, .deleted)
        XCTAssertEqual(recovered.draft.result, .deleted)
        XCTAssertEqual(recovered.draft.text, original.text)
        XCTAssertEqual(recovered.draft.idempotencyKey, original.idempotencyKey)
        XCTAssertNil(try recovered.beginSubmission(reachable: true))
        try recovered.updateText("Different lift")
        XCTAssertEqual(recovered.draft.text, original.text)
        try recovered.startAnother()
        let newDraft = try WatchLiftCaptureStore(fileURL: url).draft
        XCTAssertEqual(newDraft.phase, .editing)
        XCTAssertNotEqual(newDraft.idempotencyKey, original.idempotencyKey)
        XCTAssertEqual(newDraft.text, "")
    }

    @MainActor func testFileStorePersistsBeforeTransportAndRestoresWithoutAutomaticSend() throws {
        let directory = testArtifactDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("capture.json")
        let store = try WatchLiftCaptureStore(fileURL: url)
        try store.updateText("Squat, 70 kg, 5 reps, 3 sets")
        let beforeSave = try WatchLiftCaptureStore(fileURL: url)
        XCTAssertEqual(beforeSave.draft.text, store.draft.text)
        XCTAssertEqual(beforeSave.draft.idempotencyKey, store.draft.idempotencyKey)
        let first = try XCTUnwrap(store.beginSubmission(reachable: true))
        let recovered = try WatchLiftCaptureStore(fileURL: url)
        XCTAssertEqual(recovered.draft.phase, .uncertain)
        XCTAssertEqual(recovered.draft.requestText, first.text)
        try recovered.updateText("Changed draft")
        XCTAssertEqual(recovered.draft.text, first.text)
        XCTAssertNil(try recovered.beginSubmission(reachable: false))
        XCTAssertEqual(try recovered.beginSubmission(reachable: true), first)
        try recovered.receive(.needsDetails(question: "Which exercise?"))
        let clarification = try WatchLiftCaptureStore(fileURL: url)
        XCTAssertEqual(clarification.draft.phase, .needsDetails)
        XCTAssertEqual(clarification.draft.idempotencyKey, first.idempotencyKey)
        try clarification.updateText("Back squat, 70 kg, 5 reps, 3 sets")
        XCTAssertEqual(try clarification.beginSubmission(reachable: true)?.idempotencyKey, first.idempotencyKey)
        try clarification.receive(savedResult())
        XCTAssertEqual(try WatchLiftCaptureStore(fileURL: url).draft.phase, .saved)
    }

    @MainActor func testCorruptOrUnwritableStorageFailsClosed() throws {
        let directory = testArtifactDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("capture.json")
        try Data("not a draft".utf8).write(to: url)
        XCTAssertThrowsError(try WatchLiftCaptureStore(fileURL: url))
        let store = try WatchLiftCaptureStore(fileURL: url.appendingPathComponent("impossible.json"))
        XCTAssertThrowsError(try store.updateText("Bench"))
        XCTAssertEqual(store.draft.text, "", "A failed persistence step must not advance state")
    }

    func testWireContractRejectsInvalidOrUnboundedCapture() throws {
        let value = JarvisLiftCaptureRequest(idempotencyKey: UUID(), text: "Bench, 80kg, 4 reps")
        var request = WatchRequest(action: .captureLift, data: try WatchCodec.encode(value))
        XCTAssertTrue(request.isValid)
        XCTAssertEqual(request.liftCapture, value)
        XCTAssertEqual(try JSONDecoder().decode(WatchRequest.self, from: WatchCodec.encode(request)).liftCapture, value)
        request.itemID = "arbitrary"
        XCTAssertFalse(request.isValid)
        request.itemID = nil
        request.data = Data(#"{"idempotencyKey":"invalid","text":"Bench"}"#.utf8)
        XCTAssertFalse(request.isValid)
        request.data = try WatchCodec.encode(JarvisLiftCaptureRequest(idempotencyKey: UUID(), text: " "))
        XCTAssertFalse(request.isValid)
        request.data = try WatchCodec.encode(JarvisLiftCaptureRequest(idempotencyKey: UUID(), text: String(repeating: "ø", count: 4001)))
        XCTAssertFalse(request.isValid)
    }

    func testInvalidSavedReceiptNeverBecomesSuccess() {
        for json in [
            #"{"status":"saved","replayed":false}"#,
            #"{"status":"needsDetails","question":""}"#,
            #"{"status":"other"}"#,
            #"{"status":"saved","replayed":false,"entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench","weightKg":80,"reps":0,"sets":3,"performedAt":"2026-11-10T12:00:00Z"}}"#,
            #"{"status":"saved","replayed":true,"entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Bench","weightKg":80,"reps":4,"sets":3,"performedAt":"2026-11-10T12:00:00Z","deletedAt":"2026-11-10T12:30:00Z"}}"#
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(JarvisLiftCaptureResult.self, from: Data(json.utf8)))
        }
    }

    func testTextLimitMatchesJavaScriptUTF16LengthBeforeSubmission() throws {
        for text in [String(repeating: "a", count: 2000), String(repeating: "🟠", count: 1000)] {
            var draft = WatchLiftCaptureDraft(text: text)
            XCTAssertNotNil(draft.beginSubmission(reachable: true))
        }
        for text in [String(repeating: "a", count: 2001), String(repeating: "🟠", count: 1001)] {
            var draft = WatchLiftCaptureDraft(text: text)
            XCTAssertNil(draft.beginSubmission(reachable: true))
            XCTAssertEqual(draft.phase, .editing)
            XCTAssertEqual(draft.text, text)
            XCTAssertTrue(draft.updateText("Bench press, 80 kg, 4 reps"))
            XCTAssertNotNil(draft.beginSubmission(reachable: true))
        }
    }

    func testControlAndFormatCharactersStayEditableButCannotBeSubmitted() {
        for character in ["\u{0000}", "\u{007f}", "\u{200b}", "\u{200d}", "\u{202e}"] {
            var draft = WatchLiftCaptureDraft(text: "Bench\(character), 80 kg, 4 reps")
            XCTAssertFalse(draft.canSubmit)
            XCTAssertNil(draft.beginSubmission(reachable: true))
            XCTAssertTrue(draft.canEdit)
            XCTAssertTrue(draft.updateText("Bench press,\n80 kg,\r4 reps\t"))
            XCTAssertTrue(draft.canSubmit)
        }
    }

    private func savedResult() throws -> JarvisLiftCaptureResult {
        try JSONDecoder().decode(JarvisLiftCaptureResult.self, from: Data(
            #"{"status":"saved","entry":{"id":"00000000-0000-4000-8000-000000000001","exerciseName":"Barbell bench press","weightKg":80,"reps":4,"sets":3,"performedAt":"2026-11-10T12:00:00Z"},"replayed":true}"#.utf8
        ))
    }

    private func testArtifactDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("jarvis-lift-capture-tests-\(UUID().uuidString)")
    }
}
