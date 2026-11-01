import Foundation
import XCTest
@testable import JarvisCore

final class JarvisChatLocalizationTests: XCTestCase {
    func testEveryPlusMenuStringHasDanishAndEnglishTranslations() {
        for key in JarvisChatLocalizationKey.allCases {
            XCTAssertNotEqual(JarvisChatLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisChatLocalization.string(key, language: .en), key.rawValue)
        }

        XCTAssertEqual(JarvisChatLocalization.string(.camera, language: .da), "Kamera")
        XCTAssertEqual(JarvisChatLocalization.string(.attach, language: .en), "Attach file or photo")
        XCTAssertEqual(JarvisChatLocalization.string(.enableVideo, language: .en), "Enable video")
        XCTAssertEqual(JarvisChatLocalization.string(.shareScreen, language: .da), "Del skærm")
        XCTAssertEqual(JarvisChatLocalization.string(.voiceLanguage, language: .en), "Voice language")
        XCTAssertEqual(JarvisChatLocalization.string(.done, language: .da), "Færdig")
        XCTAssertEqual(JarvisChatLocalization.string(.done, language: .en), "Done")
        XCTAssertEqual(JarvisChatLocalization.string(.screenShareStarting, language: .da), "Starter skærmdeling…")
        XCTAssertEqual(JarvisChatLocalization.string(.screenShareLive, language: .en), "Sharing your screen with Jarvis.")
    }
}
