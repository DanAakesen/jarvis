import XCTest
@testable import JarvisCore

final class JarvisEditableLiftTests: XCTestCase {
    private let path = "Personal/Gym log/2026-11-08-1515-chest.md"
    private var row: [String: JSONValue] {
        ["exerciseName": .string("Bench press"), "weightKg": .number(70), "reps": .number(6),
         "sets": .number(3), "performedAt": .string("2026-11-08T15:15:00Z")]
    }

    func testEditRetainsTheOriginalNoteAndAdditionalOwnerContent() throws {
        let before = "---\ntype: gym-log\nsession: chest\n---\n- Lift: Bench press · 70 kg × 6 × 3\n\nKeep this personal note.\n"
        var values = row
        values["notePath"] = .string(path)
        values["noteSha"] = .string(String(repeating: "a", count: 40))
        values["noteContent"] = .string(before)
        let lift = try XCTUnwrap(JarvisEditableLift(row: values))
        let edit = JarvisLiftEdit(exerciseName: "Incline bench press", weightKg: 72.5, reps: 4, sets: 2)
        let after = try lift.replacingLift(with: edit)
        XCTAssertEqual(lift.id, path)
        XCTAssertEqual(after, before.replacingOccurrences(of: "Bench press · 70 kg × 6 × 3", with: "Incline bench press · 72.5 kg × 4 × 2"))
        XCTAssertThrowsError(try lift.replacingLift(with: .init(exerciseName: "", weightKg: 70, reps: 4, sets: 2)))
    }

    func testDisplayValuesCannotIdentifyALiftAndFractionalRepsAreRejected() throws {
        XCTAssertNil(JarvisEditableLift(row: row))
        var values = row
        values["id"] = .string("00000000-0000-4000-8000-000000000001")
        XCTAssertNotNil(JarvisEditableLift(row: values))
        values["reps"] = .number(6.5)
        XCTAssertNil(JarvisEditableLift(row: values))
        XCTAssertFalse(JarvisLiftEdit(exerciseName: "Bench\npress", weightKg: 70, reps: 6, sets: 3).isValid)
    }
}
