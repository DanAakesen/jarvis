import Foundation
import XCTest
@testable import JarvisCore

final class WatchDashboardTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-10T12:00:00Z")!
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
        return value
    }

    func testOptionalSectionsRoundTripWithoutInventingValues() throws {
        let value = WatchDashboardSnapshot(now: now, calendar: calendar)
        XCTAssertNil(value.agenda)
        XCTAssertNil(value.todayTasks)
        XCTAssertNil(value.bodyFat)
        XCTAssertNil(value.nutrition)
        XCTAssertNil(value.brief)
        XCTAssertEqual(try JSONDecoder().decode(WatchDashboardSnapshot.self, from: JSONEncoder().encode(value)), value)
    }

    func testFreshnessUsesPhoneTimeZoneAndExpiresAtMidnight() {
        let start = calendar.startOfDay(for: now)
        let midnight = calendar.date(byAdding: .day, value: 1, to: start)!
        let value = WatchDashboardSnapshot(now: midnight.addingTimeInterval(-60), calendar: calendar)
        XCTAssertEqual(value.timeZoneID, "Europe/Copenhagen")
        XCTAssertTrue(value.isCurrent(at: midnight.addingTimeInterval(-1)))
        XCTAssertFalse(value.isCurrent(at: midnight))
        XCTAssertEqual(value.expiresAt(), midnight)
        let midday = WatchDashboardSnapshot(now: now, calendar: calendar)
        XCTAssertTrue(midday.isCurrent(at: now.addingTimeInterval(899)))
        XCTAssertFalse(midday.isCurrent(at: now.addingTimeInterval(900)))
        XCTAssertFalse(midday.isCurrent(at: now.addingTimeInterval(-1)))
        var invalid = midday
        invalid.timeZoneID = "Not/AZone"
        XCTAssertFalse(invalid.isCurrent(at: now))
        invalid = midday; invalid.version = 2
        XCTAssertFalse(invalid.isCurrent(at: now))
    }

    func testBodyFatKeepsLatestTwentyRealPercentagesAndDateOnlyValues() {
        let rows: [[String: JSONValue]] = (1...25).reversed().map { index in
            ["metric_date": .string(String(format: "2026-10-%02d", index)), "metric_name": .string("body_fat_percentage"),
             "unit": .string("%"), "value": .number(Double(index))]
        }
        let points = WatchBodyFatPoint.latest(from: rows)
        XCTAssertEqual(points.count, 20)
        XCTAssertEqual(points.first?.date, "2026-10-06")
        XCTAssertEqual(points.last?.percent, 25)
        let fraction: [String: JSONValue] = ["metric_date": .string("2026-10-26"), "metric_name": .string("body_fat_percentage"),
                                              "unit": .string("fraction"), "value": .number(0.205)]
        XCTAssertEqual(WatchBodyFatPoint.latest(from: [fraction]).first?.percent ?? 0, 20.5, accuracy: 0.0001)
        var invalid = fraction; invalid["unit"] = .string("kg")
        XCTAssertTrue(WatchBodyFatPoint.latest(from: [invalid]).isEmpty)
        invalid = fraction; invalid["value"] = .number(2)
        XCTAssertTrue(WatchBodyFatPoint.latest(from: [invalid]).isEmpty)
    }

    func testNutritionDistinguishesMissingPartialAndRecordedZeroWithoutDefaultGoals() {
        let date = "2026-11-10"
        let empty = WatchNutritionSnapshot(date: date, items: [])
        XCTAssertNil(empty.carbsGrams); XCTAssertNil(empty.proteinGrams)
        XCTAssertNil(empty.energyKcal)
        XCTAssertNil(empty.carbsGoalGrams); XCTAssertNil(empty.fatGoalGrams); XCTAssertNil(empty.proteinGoalGrams)
        let row: [String: JSONValue] = [
            "meal_date": .string(date), "meal_count": .number(1), "carbohydrates_grams": .number(0),
            "fat_grams": .null, "protein_grams": .number(27), "energy_kcal": .number(308),
            "partial_nutrients": .array([.string("protein_grams")])
        ]
        let value = WatchNutritionSnapshot(date: date, items: [row], proteinGoalGrams: 125)
        XCTAssertEqual(value.carbsGrams, 0)
        XCTAssertNil(value.fatGrams)
        XCTAssertEqual(value.proteinGrams, 27)
        XCTAssertEqual(value.energyKcal, 308)
        XCTAssertEqual(value.proteinGoalGrams, 125)
        XCTAssertEqual(value.partialNutrients, ["protein_grams"])
        var unlogged = row; unlogged["meal_count"] = .number(0)
        XCTAssertNil(WatchNutritionSnapshot(date: date, items: [unlogged]).carbsGrams)
        let invalid = WatchNutritionSnapshot(date: date, carbsGrams: -1, fatGrams: .infinity, proteinGoalGrams: 0)
        XCTAssertNil(invalid.carbsGrams); XCTAssertNil(invalid.fatGrams); XCTAssertNil(invalid.proteinGoalGrams)
    }

    func testBriefComesFromActualHomeTextAtSentenceBoundaryWithOriginalTimeAndHighlights() throws {
        let text = "Your review starts soon. Bring the agenda. A later sentence is not needed."
        let source = JarvisHomeBrief(text: text, language: "en", generatedAt: "2026-11-10T12:00:00.000Z",
                                    highlights: ["review", "later sentence"])
        let value = try XCTUnwrap(WatchBriefSummary(brief: source, maximumCharacters: 45))
        XCTAssertEqual(value.text, "Your review starts soon. Bring the agenda.")
        XCTAssertEqual(value.highlights, ["review"])
        XCTAssertEqual(value.fullText, text)
        XCTAssertEqual(value.fullHighlights, ["review", "later sentence"])
        XCTAssertEqual(value.generatedAt, now)
        XCTAssertTrue(value.isCurrent(at: now.addingTimeInterval(899)))
        XCTAssertFalse(value.isCurrent(at: now.addingTimeInterval(900)))
        let longSentence = String(repeating: "A", count: 100) + ". Another sentence."
        let long = JarvisHomeBrief(text: longSentence, language: "en", generatedAt: source.generatedAt)
        XCTAssertEqual(WatchBriefSummary(brief: long, maximumCharacters: 30)?.text, String(repeating: "A", count: 100) + ".")
        let unavailable = JarvisHomeBrief(text: "The brief is unavailable.", state: "unavailable", language: "en", generatedAt: source.generatedAt)
        XCTAssertEqual(WatchBriefSummary(brief: unavailable)?.state, "unavailable")
    }

    func testDashboardPayloadDropsPreviewsNotTaskTitlesAndPreservesCounts() throws {
        let text = String(repeating: "𐐀", count: 4_000)
        let task = makeTask(id: "large", text: text)
        var dashboard = WatchDashboardSnapshot(now: now, calendar: calendar)
        dashboard.todayTasks = .init(tasks: [task, task, task], totalCount: 100)
        dashboard.upcomingTasks = .init(tasks: [task, task, task], totalCount: 150)
        let bounded = try dashboard.bounded()
        let data = try WatchCodec.encode(bounded)
        XCTAssertLessThanOrEqual(data.count, WatchLimits.payloadBytes)
        XCTAssertLessThan(try WatchCodec.encode(WatchReply(id: UUID(), data: data)).count, WatchLimits.wireBytes)
        XCTAssertEqual(bounded.todayTasks?.totalCount, 100)
        XCTAssertEqual(bounded.upcomingTasks?.totalCount, 150)
        XCTAssertTrue((bounded.todayTasks?.tasks ?? []).allSatisfy { $0.text == text })
        XCTAssertTrue((bounded.upcomingTasks?.tasks ?? []).allSatisfy { $0.text == text })
    }

    func testNotePagesPreserveFullUnicodeContentAndRejectChangedRevision() throws {
        let original = String(repeating: "A𐐀\n", count: 5_000)
        let note = VaultNote(path: "Personal/test.md", content: original, sha: String(repeating: "a", count: 40), url: "")
        var content = ""
        var page = WatchPageRequest()
        repeat {
            let value = try WatchNoteDetail(note: note, page: page)
            XCTAssertLessThan(try WatchCodec.encode(value).count, WatchLimits.payloadBytes)
            content += value.content
            guard let next = value.nextOffset else { break }
            page = .init(offset: next, revision: value.revision)
        } while true
        XCTAssertEqual(content, original)
        XCTAssertThrowsError(try WatchNoteDetail(note: note, page: .init(offset: 1)))
        XCTAssertThrowsError(try WatchNoteDetail(note: note, page: .init(offset: 1, revision: "changed")))
        XCTAssertThrowsError(try WatchNoteDetail(note: note, page: .init(offset: 2, revision: note.sha)))
    }

    func testReaderReusesBackendCalendarMetricNutritionNotesAndHomeBriefRoutes() async throws {
        let transport = DashboardTransport()
        let reader = WatchDashboardReader(client: try makeClient(transport))
        let value = try await reader.dashboard(now: now, calendar: calendar)
        XCTAssertEqual(value.agenda?.first?.title, "Review")
        XCTAssertEqual(value.bodyFat?.first?.percent, 19.5)
        XCTAssertEqual(value.notes?.first?.title, "Review notes")
        XCTAssertEqual(value.nutrition?.carbsGrams, 70)
        XCTAssertNil(value.nutrition?.fatGrams)
        XCTAssertNil(value.nutrition?.carbsGoalGrams)
        XCTAssertEqual(value.nutrition?.proteinGoalGrams, 120)
        XCTAssertEqual(value.sourceUpdatedAt["bodyFat"], ISO8601DateFormatter().date(from: "2026-11-09T08:00:00Z"))
        XCTAssertEqual(value.sourceUpdatedAt["nutrition"], ISO8601DateFormatter().date(from: "2026-11-10T11:00:00Z"))
        XCTAssertNotEqual(value.sourceUpdatedAt["bodyFat"], value.generatedAt)
        XCTAssertNotNil(value.todayTasks)
        XCTAssertNil(value.brief, "Slow generation must not block dashboard reads.")
        let beforeBrief = await transport.paths()
        XCTAssertFalse(beforeBrief.contains("/api/home/brief"))
        let brief = try await reader.brief(language: .en)
        XCTAssertEqual(brief.text, "Review your notes before the meeting.")
        let queries = await transport.healthQueries()
        let metrics = try XCTUnwrap(queries.first { $0["source"] == .string(JarvisHealthSource.metrics.rawValue) })
        XCTAssertEqual(metrics["metric"], .string("body_fat_percentage"))
        XCTAssertEqual(metrics["limit"], .number(500))
        XCTAssertEqual(metrics["startDate"], .string("2026-08-10"))
        XCTAssertEqual(metrics["endDate"], .string("2026-11-10"))
        let notes = try await reader.notes()
        XCTAssertNil(notes.nextOffset)
        let detail = try await reader.note(path: "Personal/review.md")
        XCTAssertEqual(detail.content, "# Review\n\nActual fixture content.")
    }

    func testReadDeadlineCancelsSlowOperation() async {
        do {
            let _: Int = try await WatchDashboardReader.boundedRead(timeout: .milliseconds(5)) {
                try await Task.sleep(for: .seconds(60))
                return 1
            }
            XCTFail("Expected deadline")
        } catch { XCTAssertEqual(error as? WatchFailure, .unavailable) }
    }

    func testFailedSectionsStayUnavailableWhileSuccessfulSectionsRemainUsable() async throws {
        let transport = DashboardTransport(failedPaths: ["/api/calendar/events", "/api/health/query"])
        let reader = WatchDashboardReader(client: try makeClient(transport))
        let value = try await reader.dashboard(now: now, calendar: calendar)
        XCTAssertNil(value.agenda)
        XCTAssertNil(value.bodyFat)
        XCTAssertNil(value.nutrition)
        XCTAssertEqual(value.notes?.first?.title, "Review notes")
        XCTAssertEqual(value.todayTasks?.totalCount, 0)
    }

    func testTotalReadFailureIsNotAnEmptySuccessfulDashboard() async throws {
        let transport = DashboardTransport(failedPaths: [
            "/api/calendar/events", "/api/health/query", "/api/notes", "/api/vault/tasks"
        ])
        let reader = WatchDashboardReader(client: try makeClient(transport))
        do {
            _ = try await reader.dashboard(now: now, calendar: calendar)
            XCTFail("No source could be read.")
        } catch { XCTAssertEqual(error as? WatchFailure, .failed) }
    }

    func testIncompleteAscendingMetricPageIsNeverCalledCompleteWindow() async throws {
        let transport = DashboardTransport(bodyFatHasMore: true)
        let reader = WatchDashboardReader(client: try makeClient(transport))
        do {
            _ = try await reader.bodyFat(now: now, calendar: calendar)
            XCTFail("An incomplete oldest-first page cannot establish the complete measurement window.")
        } catch { XCTAssertEqual(error as? WatchFailure, .failed) }
    }

    func testBodyFatReturnsWholeThreeCalendarMonthWindowWithoutTwentyPointTruncation() async throws {
        let start = calendar.date(from: DateComponents(year: 2026, month: 8, day: 10))!
        var rows: [[String: JSONValue]] = (0..<60).map { offset in
            let date = calendar.date(byAdding: .day, value: offset, to: start)!
            return ["metric_name": .string("body_fat_percentage"),
                    "metric_date": .string(JarvisTodayTaskLists.dayKey(date, calendar: calendar)),
                    "unit": .string("%"), "value": .number(20 - Double(offset) * 0.01)]
        }
        rows += [
            ["metric_name": .string("body_fat_percentage"), "metric_date": .string("2026-08-09"),
             "unit": .string("%"), "value": .number(22)],
            ["metric_name": .string("body_fat_percentage"), "metric_date": .string("2026-11-11"),
             "unit": .string("%"), "value": .number(18)]
        ]
        let reader = WatchDashboardReader(client: try makeClient(DashboardTransport(metricItems: rows)))
        let points = try await reader.bodyFat(now: now, calendar: calendar)
        XCTAssertEqual(points.count, 60)
        XCTAssertEqual(points.first?.date, "2026-08-10")
        XCTAssertEqual(points.last?.date, "2026-10-08")
        let dashboard = try await reader.dashboard(now: now, calendar: calendar)
        XCTAssertEqual(dashboard.bodyFat, points)
        XCTAssertLessThanOrEqual(try WatchCodec.encode(dashboard).count, WatchLimits.payloadBytes)
    }

    func testAllOpenTaskPagesFitBudgetPreserveTitlesAndIncludeFutureTasks() async throws {
        let title = String(repeating: "𐐀", count: 400)
        let notes = String(repeating: "𐐀", count: 2_000)
        let tasks = (1...25).map { index in
            VaultTask(id: String(format: "%064x", index), text: title, done: false,
                      dueDate: index == 25 ? "2026-11-11" : "2026-11-10", dueTime: nil, dueAt: nil,
                      priority: .normal, path: "Personal/tasks.md", line: index, heading: nil,
                      version: String(repeating: "a", count: 64), notes: notes)
        }
        let reader = WatchDashboardReader(client: try makeClient(DashboardTransport(tasks: tasks)))
        var all: [VaultTask] = []
        var offset = 0
        repeat {
            let page = try await reader.taskPage(now: now, calendar: calendar, offset: offset)
            XCTAssertEqual(page.totalCount, 25)
            XCTAssertEqual(page.timeZoneID, calendar.timeZone.identifier)
            XCTAssertEqual(page.dayStart, calendar.startOfDay(for: now))
            XCTAssertLessThanOrEqual(try WatchCodec.encode(page).count, WatchLimits.payloadBytes)
            XCTAssertTrue(page.tasks.allSatisfy { $0.text == title && $0.notes == notes })
            all.append(contentsOf: page.tasks)
            guard let next = page.nextOffset else { break }
            XCTAssertGreaterThan(next, offset)
            offset = next
        } while true
        XCTAssertEqual(all, tasks)
        XCTAssertEqual(all.last?.dueDate, "2026-11-11")
        let selected = try await reader.task(id: tasks.last!.id)
        XCTAssertEqual(selected, tasks.last)
        let missing = try await reader.task(id: String(repeating: "f", count: 64))
        XCTAssertNil(missing)
    }

    func testTodayDashboardAndFullTaskProjectionUsePhoneDayNotBackendToday() async throws {
        let phoneNow = ISO8601DateFormatter().date(from: "2026-11-10T23:30:00Z")!
        let days: [String?] = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", nil]
        let tasks = days.enumerated().map { index, day in
            VaultTask(id: String(format: "%064x", index + 1), text: "Task \(index)", done: false,
                      dueDate: day, dueTime: nil, dueAt: nil, priority: .normal, path: "Personal/tasks.md",
                      line: index + 1, heading: nil, version: String(repeating: "a", count: 64))
        }
        // The source fixture says November 10; the phone owner's Copenhagen day is already November 11.
        let reader = WatchDashboardReader(client: try makeClient(DashboardTransport(tasks: tasks)))
        let lists = try await reader.taskLists(now: phoneNow, calendar: calendar)
        let dashboard = try await reader.dashboard(now: phoneNow, calendar: calendar)
        let page = try await reader.taskPage(now: phoneNow, calendar: calendar)
        var ownerCalendar = Calendar(identifier: .gregorian)
        ownerCalendar.timeZone = TimeZone(identifier: page.timeZoneID)!
        let full = JarvisTodayTaskLists(tasks: page.tasks, now: page.dayStart, calendar: ownerCalendar)
        XCTAssertEqual(lists.today.map(\.dueDate), ["2026-11-09", "2026-11-10", "2026-11-11"])
        XCTAssertEqual(lists.upcoming.map(\.dueDate), ["2026-11-12"])
        XCTAssertEqual(dashboard.todayTasks?.totalCount, 3)
        XCTAssertEqual(dashboard.todayTasks?.tasks, lists.today)
        XCTAssertEqual(dashboard.upcomingTasks?.tasks, lists.upcoming)
        XCTAssertEqual(full, lists)
        XCTAssertEqual(page.tasks.map(\.dueDate), days, "Grouping must never rewrite persisted dates.")
    }

    private func makeTask(id: String, text: String) -> VaultTask {
        VaultTask(id: id, text: text, done: false, dueDate: "2026-11-10", dueTime: nil, dueAt: nil,
                  priority: .normal, path: "Personal/tasks.md", line: 1, heading: nil, version: String(repeating: "a", count: 40))
    }
    private func makeClient(_ transport: DashboardTransport) throws -> JarvisClient {
        try JarvisClient(configuration: .init(baseURL: URL(string: "https://api.example.invalid/api")!,
                                             retryPolicy: .init(maximumRetries: 0)),
                         transport: transport, tokenStore: DashboardTokenStore(), accessTokenProvider: DashboardTokenProvider())
    }
}

private actor DashboardTransport: HTTPTransport {
    private var recordedPaths: [String] = []
    private var queries: [[String: JSONValue]] = []
    private let failedPaths: Set<String>
    private let bodyFatHasMore: Bool
    private let tasks: [VaultTask]
    private let metricItems: [[String: JSONValue]]?
    init(failedPaths: Set<String> = [], bodyFatHasMore: Bool = false, tasks: [VaultTask] = [],
         metricItems: [[String: JSONValue]]? = nil) {
        self.failedPaths = failedPaths
        self.bodyFatHasMore = bodyFatHasMore
        self.tasks = tasks
        self.metricItems = metricItems
    }
    func paths() -> [String] { recordedPaths }
    func healthQueries() -> [[String: JSONValue]] { queries }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        recordedPaths.append(request.url.path)
        if failedPaths.contains(request.url.path) { throw HTTPTransportFailure.network }
        let body: String
        switch request.url.path {
        case "/api/calendar/events":
            body = #"{"events":[{"id":"one","subject":"Review","start":"2026-11-10T13:00:00Z","end":"2026-11-10T14:00:00Z"}]}"#
        case "/api/vault/tasks":
            let list = VaultTaskList(items: tasks, readAt: "2026-11-10T12:00:00Z", today: "2026-11-10",
                                     total: tasks.count, truncated: false)
            return HTTPResponse(statusCode: 200, body: try JSONEncoder().encode(list))
        case "/api/notes":
            body = #"{"notes":[{"path":"Personal/review.md","title":"Review notes","folder":"Personal","directory":"Personal","updatedAt":"2026-11-10T10:00:00Z"}],"offset":0,"limit":50,"hasMore":false}"#
        case "/api/notes/note":
            body = ##"{"path":"Personal/review.md","content":"# Review\n\nActual fixture content.","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"https://github.com/example/vault/blob/main/Personal/review.md"}"##
        case "/api/health/nutrition-targets":
            body = #"{"targets":{"proteinGrams":120,"restingKcal":null,"deficitKcal":null}}"#
        case "/api/health/query":
            let query = try JSONDecoder().decode([String: JSONValue].self, from: request.body ?? Data())
            queries.append(query)
            if query["source"] == .string(JarvisHealthSource.metrics.rawValue) {
                let rows = metricItems ?? [
                    ["metric_name": .string("body_fat_percentage"), "metric_date": .string("2026-11-09"),
                     "value": .number(19.5), "unit": .string("%"), "updated_at": .string("2026-11-09T08:00:00Z")]
                ]
                let coverage = bodyFatHasMore ? #"{"returned":\#(rows.count),"hasMore":true,"next":{"date":"2026-11-09","key":"body_fat_percentage"}}"#
                    : #"{"returned":\#(rows.count),"hasMore":false,"next":null}"#
                let items = String(decoding: try JSONEncoder().encode(rows), as: UTF8.self)
                body = #"{"source":"daily.health.metrics","items":\#(items),"status":"available","coverage":\#(coverage)}"#
            } else {
                body = #"{"source":"daily.nutrition.days","items":[{"meal_date":"2026-11-10","meal_count":1,"carbohydrates_grams":70,"protein_grams":24,"fat_grams":null,"latest_updated_at":"2026-11-10T11:00:00Z"}],"status":"available","coverage":{"returned":1,"hasMore":false,"next":null}}"#
            }
        case "/api/home/brief":
            body = #"{"text":"Review your notes before the meeting.","state":"generated","maxVisibleLines":3,"language":"en","generatedAt":"2026-11-10T12:00:00Z","evidenceRefs":[],"unavailableSources":[],"highlights":["notes"]}"#
        default: throw FixtureTransportError.requestMismatch
        }
        return HTTPResponse(statusCode: 200, body: Data(body.utf8))
    }
}

private actor DashboardTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}
private actor DashboardTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}
