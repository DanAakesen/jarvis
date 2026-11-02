import XCTest
@testable import JarvisCore

final class DictationTranscriptTests: XCTestCase {
    func testStreamingExtendsTheSameSegmentAfterTheExistingText() {
        var transcript = DictationTranscript(base: "Hello")
        XCTAssertEqual(transcript.update("one"), "Hello one")
        XCTAssertEqual(transcript.update("one two"), "Hello one two")
    }

    func testRevisedWordsReplaceThePartialResultInsteadOfAppending() {
        var transcript = DictationTranscript(base: "")
        _ = transcript.update("their going home")
        XCTAssertEqual(transcript.update("their going home now"), "their going home now")
        XCTAssertEqual(transcript.update("Their going"), "Their going")
    }

    func testRestartedSegmentKeepsTheWordsAlreadyTranscribed() {
        var transcript = DictationTranscript(base: "")
        _ = transcript.update("buy milk and eggs tomorrow")
        XCTAssertEqual(transcript.update("remember"), "buy milk and eggs tomorrow remember")
        XCTAssertEqual(transcript.update("remember the bread"), "buy milk and eggs tomorrow remember the bread")
    }

    func testEmptyReportDoesNotCommitOrDeleteText() {
        var transcript = DictationTranscript(base: "start")
        _ = transcript.update("one two")
        XCTAssertEqual(transcript.update(""), "start ")
        XCTAssertEqual(transcript.update("one two three"), "start one two three")
    }
}
