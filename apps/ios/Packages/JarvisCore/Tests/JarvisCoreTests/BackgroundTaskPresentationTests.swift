import Foundation
import XCTest
@testable import JarvisCore

final class BackgroundTaskPresentationTests: XCTestCase {
    private func task(_ index: Int, kind: String?, _ status: BackgroundTaskRecord.Status) -> BackgroundTaskRecord {
        BackgroundTaskRecord(
            jobId: String(format: "00000000-0000-0000-0000-%012d", index), kind: kind,
            title: "Job \(index)", status: status,
            startedAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:01Z"
        )
    }

    func testCompletedRoutineChecksNeverAppearInNeedsYou() {
        let tasks = (0..<50).map { task($0, kind: "proactive", .done) } + [task(90, kind: "html_app", .cancelled)]
        let presentation = BackgroundTaskPresentation(tasks: tasks)
        XCTAssertTrue(presentation.actionable.isEmpty)
        XCTAssertTrue(presentation.quiet.isEmpty)
        XCTAssertEqual(presentation.needsYouCount, 0)
    }

    func testFailedWeatherForecastIsQuietNotAHeadline() {
        let weather = task(1, kind: "html_app", .failed)
        let presentation = BackgroundTaskPresentation(tasks: [weather])
        XCTAssertEqual(presentation.quiet, [weather])
        XCTAssertTrue(presentation.actionable.isEmpty)
        XCTAssertEqual(presentation.needsYouCount, 0)
    }

    func testFailedResearchIsActionableAndRunningIsSeparate() {
        let research = task(2, kind: "research", .failed)
        let running = task(3, kind: "research", .running)
        let presentation = BackgroundTaskPresentation(tasks: [research, running, task(4, kind: nil, .failed)])
        XCTAssertEqual(presentation.actionable, [research])
        XCTAssertEqual(presentation.running, [running])
        XCTAssertEqual(presentation.quiet.count, 1)
        XCTAssertEqual(presentation.needsYouCount, 1)
    }

    func testRecordDecodesWithAndWithoutKind() throws {
        let withKind = Data(#"{"jobId":"a","kind":"proactive","title":"t","status":"done","startedAt":"s","updatedAt":"u"}"#.utf8)
        let without = Data(#"{"jobId":"a","title":"t","status":"failed","startedAt":"s","updatedAt":"u"}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(BackgroundTaskRecord.self, from: withKind).kind, "proactive")
        XCTAssertNil(try JSONDecoder().decode(BackgroundTaskRecord.self, from: without).kind)
    }
}
