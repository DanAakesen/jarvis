import XCTest
@testable import JarvisCore

final class ChatThinkingPhraseTests: XCTestCase {
    func testPicksPhraseFromRequestContext() {
        XCTAssertEqual(ChatThinkingPhrase.key(forRequest: "Hvordan er vejret i morgen?"), .thinkingWeather)
        XCTAssertEqual(ChatThinkingPhrase.key(forRequest: "What is on my calendar?"), .thinkingCalendar)
        XCTAssertEqual(ChatThinkingPhrase.key(forRequest: "Hej"), .thinkingGeneric)
        XCTAssertEqual(ChatThinkingPhrase.key(forRequest: "Hej", hasImage: true), .thinkingImage)
    }

    func testPhrasesAreLocalized() {
        XCTAssertEqual(ChatThinkingPhrase.phrase(forRequest: "weather", language: .en), "Checking the weather…")
        XCTAssertEqual(ChatThinkingPhrase.phrase(forRequest: "vejret", language: .da), "Tjekker vejret…")
    }
}
