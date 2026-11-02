import Foundation
import XCTest
@testable import JarvisCore

final class JarvisTodayGymTests: XCTestCase {
    private let zone = TimeZone(identifier: "Europe/Copenhagen")!

    private func entry(_ session: JarvisGymSessionType = .chest, lift: JarvisGymLift? = nil) -> JarvisGymLogEntry {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let date = calendar.date(from: DateComponents(year: 2026, month: 11, day: 2, hour: 14, minute: 5))!
        return JarvisGymLogEntry(performedAt: date, session: session, lift: lift)
    }

    func testFiveSessionTypesHaveBothLanguages() {
        XCTAssertEqual(JarvisGymSessionType.allCases.map(\.rawValue), ["chest", "back", "arms", "legs", "cardio"])
        XCTAssertEqual(JarvisGymSessionType.chest.title(language: .en), "Chest + Triceps + Core")
        XCTAssertEqual(JarvisGymSessionType.back.title(language: .da), "Ryg + Biceps + Core")
        XCTAssertEqual(JarvisGymSessionType.arms.shortTitle(language: .da), "Arme")
        XCTAssertEqual(JarvisGymSessionType.legs.title(language: .en), "Legs + Core")
        XCTAssertEqual(JarvisGymSessionType.cardio.shortTitle(language: .en), "Cardio")
    }

    func testVaultPathIsAValidNotePathAndRoundTrips() throws {
        for session in JarvisGymSessionType.allCases {
            let value = entry(session)
            let path = JarvisGymLogNote.path(for: value, timeZone: zone)
            XCTAssertEqual(path, "Personal/Gym log/2026-11-02-1405-\(session.rawValue).md")
            XCTAssertTrue(JarvisNotesLogic.validNotePath(path))
            let parsed = try XCTUnwrap(JarvisGymLogNote.parse(path: path, timeZone: zone))
            XCTAssertEqual(parsed.session, session)
            XCTAssertEqual(parsed.performedAt, value.performedAt)
        }
    }

    func testParseIgnoresOtherNotes() {
        XCTAssertNil(JarvisGymLogNote.parse(path: "Personal/Ideas.md", timeZone: zone))
        XCTAssertNil(JarvisGymLogNote.parse(path: "Personal/Gym log/readme.md", timeZone: zone))
        XCTAssertNil(JarvisGymLogNote.parse(path: "Personal/Gym log/2026-11-02-1405-yoga.md", timeZone: zone))
        XCTAssertNil(JarvisGymLogNote.parse(path: "Work/Gym log/2026-11-02-1405-chest.md", timeZone: zone))
    }

    func testNoteContentRecordsSessionAndOptionalLift() {
        let plain = JarvisGymLogNote.content(for: entry(.legs), timeZone: zone)
        XCTAssertTrue(plain.contains("type: gym-log"))
        XCTAssertTrue(plain.contains("session: legs"))
        XCTAssertTrue(plain.contains("# Gym log: Legs + Core"))
        XCTAssertFalse(plain.contains("Lift:"))
        let lift = JarvisGymLift(exercise: " Bench press ", weightKg: 80, reps: 5, sets: 3)
        let withLift = JarvisGymLogNote.content(for: entry(.chest, lift: lift), timeZone: zone)
        XCTAssertTrue(withLift.contains("- Lift: Bench press · 80 kg × 5 × 3"))
        XCTAssertTrue(JarvisNotesLogic.validNoteText(withLift))
    }

    func testLiftValidation() {
        XCTAssertTrue(JarvisGymLift(exercise: "Squat", weightKg: 100, reps: 5, sets: 5).isValid)
        XCTAssertTrue(JarvisGymLift(exercise: "Row", weightKg: 42.5, reps: 8, sets: 3).isValid)
        XCTAssertFalse(JarvisGymLift(exercise: "", weightKg: 100, reps: 5, sets: 5).isValid)
        XCTAssertFalse(JarvisGymLift(exercise: "Squat", weightKg: 0, reps: 5, sets: 5).isValid)
        XCTAssertFalse(JarvisGymLift(exercise: "Squat", weightKg: 100, reps: 0, sets: 5).isValid)
        XCTAssertFalse(JarvisGymLift(exercise: "Squat", weightKg: 100, reps: 5, sets: 101).isValid)
        XCTAssertFalse(JarvisGymLift(exercise: "Sq\nuat", weightKg: 100, reps: 5, sets: 5).isValid)
    }

    func testUnavailableStoresNeverReportSuccess() async {
        let store = JarvisUnavailableGymLogStore()
        do {
            try await store.save(entry())
            XCTFail("An unavailable store must not save")
        } catch {
            XCTAssertEqual(error as? JarvisGymLogError, .unavailable)
        }
        do {
            _ = try await store.entries(since: .distantPast)
            XCTFail("An unavailable store must not read")
        } catch {
            XCTAssertEqual(error as? JarvisGymLogError, .unavailable)
        }
        do {
            _ = try await JarvisUnavailableCalendarSource().entries(from: .now, to: .now)
            XCTFail("An unavailable calendar must throw")
        } catch {
            XCTAssertEqual(error as? JarvisTodayDataError, .unavailable)
        }
    }
}
