import JarvisCore
import XCTest

final class JarvisApprovalLocalizationTests: XCTestCase {
    func testEveryApprovalStringExistsInDanishAndEnglish() {
        XCTAssertEqual(JarvisAppLanguage.default, .da)
        for key in JarvisApprovalLocalizationKey.allCases {
            let danish = JarvisApprovalLocalization.string(key, language: .da)
            let english = JarvisApprovalLocalization.string(key, language: .en)

            XCTAssertNotEqual(danish, key.rawValue)
            XCTAssertNotEqual(english, key.rawValue)
            XCTAssertFalse(danish.isEmpty)
            XCTAssertFalse(english.isEmpty)
        }
    }

    func testFactoryActivityLabelsExistInDanishAndEnglish() {
        for key in [JarvisFactoryLocalizationKey.title, .running, .activityProgress] {
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .en), key.rawValue)
        }
    }
}
