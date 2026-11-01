import Foundation
import XCTest
@testable import JarvisCore

final class JarvisChatLocalizationTests: XCTestCase {
    func testEveryChatControlStringHasDanishAndEnglishTranslations() {
        for key in JarvisChatLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisChatLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisChatLocalization.string(key, language: .en), key.rawValue)
        }

        XCTAssertEqual(JarvisChatLocalization.string(.camera, language: .da), "Kamera")
        XCTAssertEqual(JarvisChatLocalization.string(.attach, language: .en), "Attach file or photo")
        XCTAssertEqual(JarvisChatLocalization.string(.enableVideo, language: .en), "Enable video")
        XCTAssertEqual(JarvisChatLocalization.string(.shareScreen, language: .da), "Del skærm")
        XCTAssertEqual(JarvisChatLocalization.string(.voiceLanguage, language: .en), "Voice language")
        XCTAssertEqual(JarvisChatLocalization.string(.dictate, language: .da), "Dikter")
        XCTAssertEqual(JarvisChatLocalization.string(.startVoice, language: .en), "Start voice")
        XCTAssertEqual(JarvisChatLocalization.string(.sendMessage, language: .da), "Send besked")
        XCTAssertEqual(JarvisChatLocalization.string(.done, language: .da), "Færdig")
        XCTAssertEqual(JarvisChatLocalization.string(.done, language: .en), "Done")
    }
}
