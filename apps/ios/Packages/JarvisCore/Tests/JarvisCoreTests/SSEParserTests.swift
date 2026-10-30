import Foundation
import XCTest
@testable import JarvisCore

final class SSEParserTests: XCTestCase {
    func testEveryByteBoundaryProducesTheSameEvents() {
        let sample = Data(
            ": heartbeat\r\nid: 17\r\nevent: delta\r\ndata: {\"text\":\"café\"}\r\ndata: continued\r\nretry: 2500\r\n\r\nevent: future\ndata: preserved"
                .utf8
        )
        var expectedParser = SSEParser()
        let expected = expectedParser.append(sample) + expectedParser.finish()

        for boundary in 0...sample.count {
            var parser = SSEParser()
            let first = parser.append(sample.prefix(boundary))
            let second = parser.append(sample.suffix(sample.count - boundary))
            let actual = first + second + parser.finish()
            XCTAssertEqual(actual, expected, "Different result when split at byte \(boundary)")
        }

        XCTAssertEqual(expected.map(\.name), ["delta", "future"])
        XCTAssertEqual(expected[0].data, "{\"text\":\"café\"}\ncontinued")
        XCTAssertEqual(expected[0].id, "17")
        XCTAssertEqual(expected[0].retry, 2500)
        XCTAssertEqual(expected[1].id, "17")
    }

    func testCommentsAreIgnoredAndFieldsFollowSSERules() {
        var parser = SSEParser()

        let events = parser.append(Data(
            ": ignored\nid: invalid\u{0}id\nretry: 1.5\nevent: \ndata:  first\ndata:\n\n".utf8
        )) + parser.finish()

        XCTAssertEqual(events, [
            ServerSentEvent(name: "message", data: " first\n", id: nil, retry: nil),
        ])
    }

    func testFinishDispatchesAnEventWithoutTrailingBlankLine() {
        var parser = SSEParser()
        XCTAssertTrue(parser.append(Data("event: delta\ndata: final fragment".utf8)).isEmpty)

        XCTAssertEqual(
            parser.finish(),
            [ServerSentEvent(name: "delta", data: "final fragment", id: nil, retry: nil)]
        )
        XCTAssertTrue(parser.finish().isEmpty)
    }

    func testMultibyteUTF8MayBeSplitAcrossChunks() {
        let sample = Data("data: 🌱\n\n".utf8)
        var parser = SSEParser()
        var events: [ServerSentEvent] = []
        for byte in sample {
            events += parser.append(Data([byte]))
        }
        events += parser.finish()

        XCTAssertEqual(events.map(\.data), ["🌱"])
    }
}
