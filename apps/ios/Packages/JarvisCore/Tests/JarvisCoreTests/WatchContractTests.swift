import Foundation
import XCTest
@testable import JarvisCore

final class WatchContractTests: XCTestCase {
    func testDictationNeverSendsAndFailurePreservesDraft() {
        var composer = WatchComposer()
        composer.dictate("Review this first")
        XCTAssertFalse(composer.sending)
        XCTAssertEqual(composer.beginSend(), "Review this first")
        XCTAssertNil(composer.beginSend())
        composer.finishSend(success: false)
        XCTAssertEqual(composer.draft, "Review this first")
        XCTAssertEqual(composer.beginSend(), "Review this first")
        composer.finishSend(success: true)
        XCTAssertEqual(composer.draft, "")
    }
    func testBlankAndOversizedMessagesAreRejected() {
        XCTAssertFalse(WatchRequest(action: .sendTurn, text: " \n ").isValid)
        XCTAssertFalse(WatchRequest(action: .sendTurn, text: String(repeating: "a", count: 8001)).isValid)
        XCTAssertFalse(WatchRequest(action: .audio, data: Data(repeating: 0, count: 40_001)).isValid)
    }
    func testSnapshotsExpireAndDoNotSurviveMidnight() {
        var calendar = Calendar(identifier: .iso8601); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_793_145_590)).addingTimeInterval(43_200)
        var snapshot = WatchHealthSnapshot(now: now, calendar: calendar)
        XCTAssertTrue(snapshot.isCurrent(at: now.addingTimeInterval(899), calendar: calendar))
        XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(900), calendar: calendar))
        XCTAssertFalse(snapshot.isCurrent(at: now.addingTimeInterval(-1), calendar: calendar))
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
        snapshot = .init(now: midnight.addingTimeInterval(-1), calendar: calendar)
        XCTAssertFalse(snapshot.isCurrent(at: midnight, calendar: calendar))
    }
    func testMissingHealthIsNotZeroAndHourlyChartIsCumulative() throws {
        var snapshot = WatchHealthSnapshot()
        XCTAssertNil(snapshot.steps); XCTAssertNil(snapshot.tasksToday); XCTAssertNil(snapshot.dailyKcal)
        snapshot.hourlySteps = [0, 20, 30, 0, 100]
        XCTAssertEqual(snapshot.cumulativeSteps, [0, 20, 50, 50, 150])
        let data = try JSONEncoder().encode(snapshot)
        XCTAssertEqual(try JSONDecoder().decode(WatchHealthSnapshot.self, from: data), snapshot)
        let wire = String(decoding: data, as: UTF8.self).lowercased()
        for secret in ["token", "credential", "authorization", "password"] { XCTAssertFalse(wire.contains(secret)) }
    }
    func testLiftValidationAndRetryIdentity() throws {
        let id = UUID()
        let value = WatchLiftInput(submissionID: id, exercise: "Bench", kilograms: 62.5, reps: 8, sets: 3)
        XCTAssertTrue(value.isValid)
        XCTAssertEqual(try JSONDecoder().decode(WatchLiftInput.self, from: JSONEncoder().encode(value)).submissionID, id)
        XCTAssertFalse(WatchLiftInput(exercise: "", kilograms: 10, reps: 1, sets: 1).isValid)
        XCTAssertFalse(WatchLiftInput(exercise: "Bench", kilograms: .infinity, reps: 1, sets: 1).isValid)
        XCTAssertFalse(WatchLiftInput(exercise: "Bench", kilograms: 1.001, reps: 1, sets: 1).isValid)
        XCTAssertFalse(WatchLiftInput(exercise: "Bench", kilograms: 1, reps: 0, sets: 1).isValid)
    }
    func testWireRoundTripAndNoArbitraryBackendCommand() throws {
        let request = WatchRequest(action: .saveLift, itemID: "lift-id", data: Data([1, 2]))
        let wire = try JSONEncoder().encode(WatchWire.request(request))
        guard case .request(let read) = try JSONDecoder().decode(WatchWire.self, from: wire) else { return XCTFail() }
        XCTAssertEqual(read.id, request.id); XCTAssertEqual(read.action, .saveLift); XCTAssertEqual(read.data, Data([1, 2]))
        XCTAssertNil(WatchAction(rawValue: "https://example.com"))
        XCTAssertNil(WatchAction(rawValue: "startFactoryTask"))
    }
}
