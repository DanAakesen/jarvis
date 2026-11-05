import Foundation
import XCTest
@testable import JarvisCore

final class JarvisFactoryCountsTests: XCTestCase {
    private func card(_ number: Int) -> String {
        """
        {"issue": {"number": \(number), "url": "https://github.com/sample/repo/issues/\(number)", "title": "Synthetic \(number)",
         "taskCode": null, "labels": [], "worker": null, "state": "open", "updatedAt": "2026-10-31T08:00:00Z",
         "closedAt": null, "blockedBy": []}, "pr": null, "task": null}
        """
    }

    private func column(_ id: String, _ numbers: Range<Int>) -> String {
        "{\"id\": \"\(id)\", \"cards\": [\(numbers.map(card).joined(separator: ","))]}"
    }

    private func board() throws -> FactoryBoard {
        let json = """
        {"project": {"id": "7", "repo": "sample/repo"}, "fetchedAt": "2026-10-31T09:00:00Z", "stale": false,
         "columns": [\(column("backlog", 100..<103)), \(column("needs_dan", 200..<201)), \(column("ready", 300..<312)),
                     \(column("in_progress", 400..<413)), \(column("in_review", 500..<507)), \(column("done", 600..<650))]}
        """
        return try JSONDecoder().decode(FactoryBoard.self, from: Data(json.utf8))
    }

    /// Cards that no Jarvis task is attached to (plain GitHub issues) still count, exactly as the list shows them.
    func testHeroCountsComeFromTheSameCardsAsTheList() throws {
        let board = try board()
        let counts = JarvisFactoryPagePhrase.Counts(board: board)
        XCTAssertEqual(counts.total, 3 + 1 + 12 + 13 + 7 + 50)
        XCTAssertEqual(counts.running, 13)
        XCTAssertEqual(counts.review, 7)
        XCTAssertEqual(counts.needs, 1)
        let listed = JarvisFactoryPresentation.cards(from: board, segment: .board)
        XCTAssertEqual(listed.count, counts.total)
        XCTAssertEqual(listed.filter { $0.column == .inProgress }.count, counts.running)
        XCTAssertEqual(listed.filter { $0.column == .inReview }.count, counts.review)
    }

    func testOnlyRealNetworkFailuresAreOffline() {
        XCTAssertTrue(JarvisFactoryConnectionPolicy.isNetworkFailure(JarvisClientError.networkFailure))
        XCTAssertTrue(JarvisFactoryConnectionPolicy.isNetworkFailure(URLError(.notConnectedToInternet)))
        XCTAssertFalse(JarvisFactoryConnectionPolicy.isNetworkFailure(JarvisClientError.serviceUnavailable))
        XCTAssertFalse(JarvisFactoryConnectionPolicy.isNetworkFailure(JarvisClientError.httpStatus(500)))
        XCTAssertFalse(JarvisFactoryConnectionPolicy.isNetworkFailure(JarvisFactoryClientError.invalidResponse))
    }
}

final class JarvisFactoryModelOptionsTests: XCTestCase {
    private func deployment(_ name: String, efforts: [String]) throws -> JarvisModelDeployment {
        let json = """
        {"name": "\(name)", "model": "m", "version": "1", "sku": "s", "capacity": 1, "capabilities": [],
         "reasoningEfforts": \(efforts.map { "\"\($0)\"" }.joined(separator: ",").wrapped)}
        """
        return try JSONDecoder().decode(JarvisModelDeployment.self, from: Data(json.utf8))
    }

    func testOptionsComeFromDeployedModels() throws {
        let deployments = [
            try deployment("alpha", efforts: ["high", "low"]),
            try deployment("beta", efforts: ["medium"]),
            try deployment("alpha", efforts: ["low"]),
        ]
        XCTAssertEqual(JarvisFactoryModelOptions.modelNames(deployments), ["alpha", "beta"])
        XCTAssertEqual(JarvisFactoryModelOptions.reasoningEfforts(deployments, selectedModel: ""), ["low", "medium", "high"])
        XCTAssertEqual(JarvisFactoryModelOptions.reasoningEfforts(deployments, selectedModel: "beta"), ["medium"])
        XCTAssertEqual(JarvisFactoryModelOptions.reasoningEfforts(deployments, selectedModel: "missing"), [])
    }
}

private extension String {
    var wrapped: String { "[\(self)]" }
}
