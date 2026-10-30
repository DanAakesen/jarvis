import Foundation
import XCTest
@testable import JarvisCore

final class GeneratedViewTests: XCTestCase {
    func testDecodesEveryRendererAndRoundTrips() throws {
        for sample in rendererSamples {
            let decoded = try decodeView(sample)
            let encoded = try JSONEncoder().encode(decoded)
            let decodedAgain = try JSONDecoder().decode(GeneratedView.self, from: encoded)
            XCTAssertEqual(decodedAgain, decoded, "Round trip failed for \(sample["renderer"] ?? "unknown")")
        }
    }

    func testRejectsChartWithMoreThanOneThousandTotalPointsAtFieldPath() throws {
        let data: [String: Any] = [
            "kind": "line",
            "series": [
                ["name": "First", "points": points(count: 400)],
                ["name": "Second", "points": points(count: 400)],
                ["name": "Third", "points": points(count: 201)],
            ],
        ]

        assertInvalidView(makeView(renderer: "chart", data: data), path: "view.data.series")
    }

    func testRejectsEleventhActionAtFieldPath() throws {
        let actions = Array(repeating: ["type": "call-tool", "tool": "read_fixture"], count: 11)
        assertInvalidView(makeView(renderer: "text", data: ["format": "plain", "content": "Synthetic"], actions: actions),
                          path: "view.actions")
    }

    func testRequiredFieldsHaveTypedPaths() throws {
        var view = makeView(renderer: "text", data: ["format": "plain", "content": "Synthetic"])
        view.removeValue(forKey: "title")
        assertInvalidView(view, path: "view.title")
    }

    func testUnknownRendererAndUnsupportedVersionKeepRawJSON() throws {
        let unknown = makeView(
            renderer: "future-chart",
            data: ["anything": ["future": true]],
            extra: ["futureField": "retained"]
        )
        let unknownView = try decodeView(unknown)
        guard case .unknown(let renderer, let raw) = unknownView else {
            return XCTFail("Expected unknown renderer")
        }
        XCTAssertEqual(renderer, "future-chart")
        XCTAssertEqual(raw, try jsonValue(unknown))
        XCTAssertEqual(try JSONDecoder().decode(GeneratedView.self, from: JSONEncoder().encode(unknownView)), unknownView)

        var unsupported = makeView(renderer: "text", data: ["format": "plain", "content": "Synthetic"])
        unsupported["version"] = 2
        let unsupportedView = try decodeView(unsupported)
        guard case .unsupportedVersion(let version, let raw) = unsupportedView else {
            return XCTFail("Expected unsupported version")
        }
        XCTAssertEqual(version, .number(2))
        XCTAssertEqual(raw, try jsonValue(unsupported))
        XCTAssertEqual(
            try JSONDecoder().decode(GeneratedView.self, from: JSONEncoder().encode(unsupportedView)),
            unsupportedView
        )
    }

    func testDataOnlyHTMLArtifactAccepts512KiBAndRejectsLargerUTF8Payload() throws {
        var artifact = htmlArtifact(html: String(repeating: "a", count: GeneratedViewLimits.htmlArtifactBytes))
        XCTAssertNoThrow(try decodeArtifact(artifact))

        artifact["html"] = String(repeating: "a", count: GeneratedViewLimits.htmlArtifactBytes + 1)
        assertInvalidArtifact(artifact, path: "artifact.html")

        artifact["html"] = String(repeating: "é", count: GeneratedViewLimits.htmlArtifactBytes / 2 + 1)
        assertInvalidArtifact(artifact, path: "artifact.html")
    }

    func testGeneratedViewKindsAndLimitsStayInParityWithWebContract() throws {
        let source = try contractSource()
        XCTAssertEqual(
            try stringConstants(in: source, declaration: "generatedViewRenderers"),
            [
                "table", "list", "detail", "text", "timeline", "chart", "task-card", "status", "image",
                "html-app", "knowledge-graph", "code",
            ]
        )
        XCTAssertEqual(
            try stringConstants(in: source, declaration: "generatedViewActionTypes"),
            ["open-route", "open-link", "call-tool", "window"]
        )
        XCTAssertTrue(source.contains("actions: array(actionSchema, 10)"))
        XCTAssertTrue(source.contains("data.series.length > 5"))
        XCTAssertTrue(source.contains("points > 1_000"))
        XCTAssertTrue(source.contains("export const htmlArtifactByteLimit = 512 * 1024;"))
        XCTAssertEqual(GeneratedViewLimits.actionsPerView, 10)
        XCTAssertEqual(GeneratedViewLimits.chartSeries, 5)
        XCTAssertEqual(GeneratedViewLimits.chartPoints, 1_000)
        XCTAssertEqual(GeneratedViewLimits.htmlArtifactBytes, 524_288)
    }

    private var rendererSamples: [[String: Any]] {
        [
            makeView(renderer: "table", data: ["columns": ["Value"], "rows": [[1], [NSNull()]]]),
            makeView(renderer: "list", data: [
                "items": [[
                    "title": "Synthetic item",
                    "details": [["label": "State", "value": "Ready"]],
                    "action": ["type": "open-link", "url": "https://github.com/example", "label": "Source"],
                ]],
            ]),
            makeView(renderer: "detail", data: ["fields": [["label": "State", "value": "Ready"]]]),
            makeView(renderer: "text", data: ["format": "markdown", "content": "**Synthetic**"]),
            makeView(renderer: "timeline", data: [
                "events": [["at": "2026-01-31", "title": "Synthetic event"]],
            ]),
            makeView(renderer: "chart", data: [
                "kind": "line",
                "series": [["name": "Synthetic series", "points": [["x": 1, "y": 2]]]],
            ]),
            makeView(renderer: "task-card", data: [
                "id": "task-fixture", "title": "Synthetic task", "state": "ready", "summary": "No owner data",
            ]),
            makeView(renderer: "status", data: ["label": "Synthetic status", "state": "ok"]),
            makeView(renderer: "image", data: [
                "images": [["url": "https://github.com/example/image.png", "alt": "Synthetic image"]],
            ]),
            makeView(renderer: "html-app", data: ["artifactId": "123e4567-e89b-42d3-a456-426614174000"]),
            makeView(renderer: "knowledge-graph", data: ["query": "synthetic query", "highlight": []]),
            makeView(renderer: "code", data: [
                "repo": "example/project",
                "path": "src/example.swift",
                "content": "let fixture = true\n",
                "startLine": 10,
                "highlight": [["from": 10, "to": 10]],
            ]),
        ]
    }

    private func makeView(
        renderer: String,
        data: [String: Any],
        actions: [[String: Any]] = [
            ["type": "open-route", "route": "/usage"],
            ["type": "open-link", "url": "https://github.com/example", "label": "Source"],
            ["type": "call-tool", "tool": "read_fixture"],
            ["type": "window", "operation": "move", "windowId": "fixture", "x": 0, "y": 1],
        ],
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var view: [String: Any] = [
            "version": 1,
            "title": "Synthetic generated view",
            "renderer": renderer,
            "source": [
                "id": "now",
                "status": "complete",
                "page": ["limit": 5, "offset": 0, "total": 5, "nextOffset": NSNull()],
            ],
            "data": data,
            "actions": actions,
        ]
        view.merge(extra) { _, new in new }
        return view
    }

    private func htmlArtifact(html: String) -> [String: Any] {
        [
            "id": "123e4567-e89b-42d3-a456-426614174000",
            "kind": "html",
            "title": "Synthetic artifact",
            "html": html,
            "sources": [["title": "Synthetic source", "url": "https://example.invalid/source"]],
            "createdAt": "2026-01-31T09:00:00Z",
            "pinned": false,
        ]
    }

    private func decodeView(_ value: [String: Any]) throws -> GeneratedView {
        try JSONDecoder().decode(GeneratedView.self, from: JSONSerialization.data(withJSONObject: value))
    }

    private func decodeArtifact(_ value: [String: Any]) throws -> HtmlArtifact {
        try JSONDecoder().decode(HtmlArtifact.self, from: JSONSerialization.data(withJSONObject: value))
    }

    private func assertInvalidView(_ value: [String: Any], path: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try decodeView(value), file: file, line: line) { error in
            guard case GeneratedViewValidationError.invalid(let actualPath, _) = error else {
                return XCTFail("Expected a typed validation error, got \(error)", file: file, line: line)
            }
            XCTAssertEqual(actualPath, path, file: file, line: line)
        }
    }

    private func assertInvalidArtifact(
        _ value: [String: Any],
        path: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(try decodeArtifact(value), file: file, line: line) { error in
            guard case GeneratedViewValidationError.invalid(let actualPath, _) = error else {
                return XCTFail("Expected a typed validation error, got \(error)", file: file, line: line)
            }
            XCTAssertEqual(actualPath, path, file: file, line: line)
        }
    }

    private func points(count: Int) -> [[String: Int]] {
        (0..<count).map { ["x": $0, "y": $0] }
    }

    private func jsonValue(_ value: [String: Any]) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: value))
    }

    private func contractSource() throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root.deleteLastPathComponent() }
        return try String(contentsOf: root.appendingPathComponent("packages/contracts/src/index.js"), encoding: .utf8)
    }

    private func stringConstants(in source: String, declaration: String) throws -> [String] {
        let declarationPattern = #"export const "# + NSRegularExpression.escapedPattern(for: declaration) +
            #" = Object\.freeze\(\[([\s\S]*?)\]\);"#
        let regex = try NSRegularExpression(pattern: declarationPattern)
        let sourceRange = NSRange(source.startIndex..<source.endIndex, in: source)
        guard let match = regex.firstMatch(in: source, range: sourceRange),
              let contentRange = Range(match.range(at: 1), in: source) else {
            throw GeneratedViewValidationError.invalid(path: declaration, reason: "contract declaration was not found")
        }
        let contents = String(source[contentRange])
        let stringRegex = try NSRegularExpression(pattern: #"'([^']+)'"#)
        let contentsRange = NSRange(contents.startIndex..<contents.endIndex, in: contents)
        return stringRegex.matches(in: contents, range: contentsRange).compactMap { item in
            guard let range = Range(item.range(at: 1), in: contents) else { return nil }
            return String(contents[range])
        }
    }
}
