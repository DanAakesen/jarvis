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
        XCTAssertEqual(JarvisGymSessionType.loggable.map(\.rawValue), ["chest", "back", "arms", "legs", "cardio"])
        XCTAssertEqual(JarvisGymSessionType.strength.title(language: .en), "Strength training")
        XCTAssertEqual(JarvisGymSessionType.strength.title(language: .da), "Styrketræning")
        XCTAssertFalse(JarvisGymSessionType.other.shortTitle(language: .da).hasPrefix("today."))
        XCTAssertEqual(JarvisGymSessionType.chest.title(language: .en), "Chest + Triceps + Core")
        XCTAssertEqual(JarvisGymSessionType.back.title(language: .da), "Ryg + Biceps + Core")
        XCTAssertEqual(JarvisGymSessionType.arms.shortTitle(language: .da), "Arme")
        XCTAssertEqual(JarvisGymSessionType.legs.title(language: .en), "Legs + Core")
        XCTAssertEqual(JarvisGymSessionType.cardio.shortTitle(language: .en), "Cardio")
    }

    func testHealthStrengthMergesWithAnyNearbyStrengthLogButNotCardio() {
        XCTAssertTrue(JarvisCombinedGymLogStore.sameWorkout(.chest, .strength))
        XCTAssertFalse(JarvisCombinedGymLogStore.sameWorkout(.cardio, .strength))
        XCTAssertFalse(JarvisCombinedGymLogStore.sameWorkout(.chest, .cardio))
    }

    func testDurationTextAndActiveSummary() {
        XCTAssertEqual(JarvisTodayLocalization.durationText(minutes: 45, language: .en), "45m")
        XCTAssertEqual(JarvisTodayLocalization.durationText(minutes: 125, language: .da), "2t 5m")
        XCTAssertEqual(JarvisTodayLocalization.durationText(minutes: 120, language: .en), "2h")
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let entries = [
            JarvisGymLogEntry(performedAt: now, session: .strength, durationMinutes: 40, activeKilocalories: 250),
            JarvisGymLogEntry(performedAt: now, session: .cardio, durationMinutes: 30.4, activeKilocalories: 300),
            JarvisGymLogEntry(performedAt: now.addingTimeInterval(-40 * 86_400), session: .cardio, durationMinutes: 99),
        ]
        let display = JarvisTodayActivityDisplay(
            state: JarvisTodayActivityState(range: .week), workouts: entries,
            steps: .empty,
            now: now, language: .en
        )
        XCTAssertEqual(display.totalWorkouts, 2)
        XCTAssertEqual(display.activeMinutes, 70)
        XCTAssertEqual(display.activeKilocalories, 550)
    }

    func testLiftsHaveBothLanguagesAndAValidSession() {
        for lift in JarvisGymLiftType.allCases {
            for language in [JarvisAppLanguage.da, .en] {
                let title = lift.title(language: language)
                XCTAssertFalse(title.isEmpty)
                XCTAssertFalse(title.hasPrefix("today."), "Missing \(language) string for \(lift)")
            }
            XCTAssertTrue(JarvisGymSessionType.allCases.contains(lift.session))
        }
        XCTAssertEqual(JarvisGymLiftType.benchPress.title(language: .da), "Bænkpres")
    }

    func testSavedHomeLiftCanBeReadBackWithoutInventingMissingValues() throws {
        let lift = JarvisGymLift(exercise: "Bench press", weightKg: 62.5, reps: 8, sets: 3)
        let content = JarvisGymLogNote.content(for: entry(.chest, lift: lift), timeZone: zone)
        XCTAssertEqual(JarvisGymLogNote.lift(from: content), lift)
        XCTAssertNil(JarvisGymLogNote.lift(from: JarvisGymLogNote.content(for: entry(.legs), timeZone: zone)))
        XCTAssertNil(JarvisGymLogNote.lift(from: "- Lift: Bench press · 62.5 kg × 0 × 3"))
        XCTAssertNil(JarvisGymLogNote.lift(from: "- Lift: Bench press · unknown kg × 8 × 3"))
    }

    func testRecentVaultLiftsReadsTheNewestSavedNoteAndReportsItsReadLimit() async throws {
        let lift = JarvisGymLift(exercise: "Bench press", weightKg: 62.5, reps: 8, sets: 3)
        let latest = entry(.chest, lift: lift)
        let previous = JarvisGymLogEntry(performedAt: latest.performedAt - 86400, session: .legs)
        let path = JarvisGymLogNote.path(for: latest, timeZone: zone)
        let paths = [JarvisGymLogNote.path(for: previous, timeZone: zone), path]
        let notes: [[String: Any]] = paths.map {
            ["path": $0, "title": "Gym log", "folder": "Personal", "directory": JarvisGymLogNote.folder,
             "updatedAt": "2026-11-02T13:05:00Z"]
        }
        let interactions: [[String: Any]] = [
            ["method": "GET", "path": "/api/notes", "query": ["limit": "50", "offset": "0", "directory": JarvisGymLogNote.folder],
             "response": ["statusCode": 200, "body": ["notes": notes, "limit": 50, "offset": 0, "hasMore": false]]],
            ["method": "GET", "path": "/api/notes/note", "query": ["path": path],
             "response": ["statusCode": 200, "body": ["path": path,
                "content": JarvisGymLogNote.content(for: latest, timeZone: zone), "sha": String(repeating: "a", count: 40),
                "url": "https://github.com/example/vault/blob/main/log.md"]]],
        ]
        let transport = try FixtureTransport(scenario: JSONSerialization.data(withJSONObject: ["version": 1, "interactions": interactions]))
        let client = JarvisNotesClient(client: try JarvisClient(
            configuration: JarvisClientConfiguration(baseURL: URL(string: "https://fixture.invalid/api")!),
            transport: transport, tokenStore: GymHistoryTokenStore(), accessTokenProvider: GymHistoryTokenProvider()
        ))
        let history = try await JarvisVaultGymLogStore(client: client, timeZone: zone)
            .recentLifts(since: latest.performedAt - 172800, maximumNoteReads: 1)
        XCTAssertEqual(history.entries.map(\.lift), [lift])
        XCTAssertEqual(history.entries.first?.performedAt, latest.performedAt)
        XCTAssertTrue(history.partial)
        let remaining = await transport.remainingInteractions()
        XCTAssertEqual(remaining, 0)
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

final class JarvisCombinedGymLogStoreTests: XCTestCase {
    private struct Stub: JarvisGymLogStore {
        let result: Result<[JarvisGymLogEntry], JarvisGymLogError>
        func save(_ entry: JarvisGymLogEntry) async throws { throw JarvisGymLogError.unavailable }
        func entries(since: Date) async throws -> [JarvisGymLogEntry] { try result.get() }
    }

    private let day = Date(timeIntervalSince1970: 1_800_000_000)

    func testMergesSourcesAndDropsNearDuplicates() async throws {
        let vault = JarvisGymLogEntry(performedAt: day, session: .cardio)
        let duplicate = JarvisGymLogEntry(performedAt: day.addingTimeInterval(1800), session: .cardio)
        let run = JarvisGymLogEntry(performedAt: day.addingTimeInterval(86_400), session: .cardio)
        let store = JarvisCombinedGymLogStore(
            primary: Stub(result: .success([vault])), others: [Stub(result: .success([duplicate, run]))]
        )
        let entries = try await store.entries(since: day)
        XCTAssertEqual(entries, [run, vault])
    }

    func testOneFailingSourceDoesNotHideTheOther() async throws {
        let run = JarvisGymLogEntry(performedAt: day, session: .cardio)
        let store = JarvisCombinedGymLogStore(
            primary: Stub(result: .failure(.failed)), others: [Stub(result: .success([run]))]
        )
        let entries = try await store.entries(since: day)
        XCTAssertEqual(entries, [run])
    }

    func testThrowsWhenEverySourceFailsAndSavesOnlyToThePrimary() async {
        let store = JarvisCombinedGymLogStore(
            primary: Stub(result: .failure(.failed)), others: [Stub(result: .failure(.unavailable))]
        )
        do {
            _ = try await store.entries(since: day)
            XCTFail("Expected failure")
        } catch {
            XCTAssertEqual(error as? JarvisGymLogError, .failed)
        }
    }
}

private actor GymHistoryTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.session" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}
private struct GymHistoryTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.access" }
    func requestSignIn() async {}
}
