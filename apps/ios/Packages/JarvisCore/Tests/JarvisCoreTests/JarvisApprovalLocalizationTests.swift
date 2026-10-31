import JarvisCore
import XCTest

final class JarvisApprovalLocalizationTests: XCTestCase {
    func testEveryApprovalStringExistsInDanishAndEnglish() {
        for key in JarvisApprovalLocalizationKey.allCases {
            let danish = JarvisApprovalLocalization.string(key, language: .da)
            let english = JarvisApprovalLocalization.string(key, language: .en)

            XCTAssertNotEqual(danish, key.rawValue)
            XCTAssertNotEqual(english, key.rawValue)
            XCTAssertFalse(danish.isEmpty)
            XCTAssertFalse(english.isEmpty)
        }
    }
}
