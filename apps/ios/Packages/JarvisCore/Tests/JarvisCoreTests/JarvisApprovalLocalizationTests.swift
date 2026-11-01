import Foundation
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

    func testExpiryTemplateCombinesWithSystemFormattedAbsoluteTime() {
        let expiry = Date(timeIntervalSince1970: 1_793_538_000)
        for language in [JarvisAppLanguage.da, .en] {
            let time = expiry.formatted(.dateTime.hour().minute().locale(language.locale))
            let template = JarvisApprovalLocalization.string(.expires, language: language)
            let text = String(format: template, locale: language.locale, arguments: [time])

            XCTAssertEqual(text, (language == .da ? "Udløber kl. " : "Expires at ") + time)
            XCTAssertFalse(text.contains("%@"))
            XCTAssertFalse(text.contains("at in "))
            XCTAssertFalse(text.contains("kl. om "))
        }
    }

    func testFactoryActivityLabelsExistInDanishAndEnglish() {
        for key in [JarvisFactoryLocalizationKey.title, .running, .activityProgress] {
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .da), key.rawValue)
            XCTAssertNotEqual(JarvisFactoryLocalization.string(key, language: .en), key.rawValue)
        }
    }
}
