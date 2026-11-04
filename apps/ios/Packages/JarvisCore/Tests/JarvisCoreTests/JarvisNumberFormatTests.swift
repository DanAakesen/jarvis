import XCTest
@testable import JarvisCore

final class JarvisNumberFormatTests: XCTestCase {
    func testNumbersBelowAThousandAreWrittenInFull() {
        XCTAssertEqual(JarvisNumberFormat.compact(0, language: .en), "0")
        XCTAssertEqual(JarvisNumberFormat.compact(950, language: .en), "950")
        XCTAssertEqual(JarvisNumberFormat.compact(999, language: .en), "999")
    }

    func testThousandsUseK() {
        XCTAssertEqual(JarvisNumberFormat.compact(1_000, language: .en), "1k")
        XCTAssertEqual(JarvisNumberFormat.compact(4_200, language: .en), "4.2k")
        XCTAssertEqual(JarvisNumberFormat.compact(12_345, language: .en), "12k")
        XCTAssertEqual(JarvisNumberFormat.compact(162_000, language: .en), "162k")
    }

    func testDanishUsesACommaDecimalSeparator() {
        XCTAssertEqual(JarvisNumberFormat.compact(4_200, language: .da), "4,2k")
    }

    func testRoundingNeverShowsAThousandK() {
        XCTAssertEqual(JarvisNumberFormat.compact(999_600, language: .en), "1M")
        XCTAssertEqual(JarvisNumberFormat.compact(9_960, language: .en), "10k")
    }

    func testMillionsUseM() {
        XCTAssertEqual(JarvisNumberFormat.compact(2_500_000, language: .en), "2.5M")
    }

    func testNegativeAndNonFiniteValues() {
        XCTAssertEqual(JarvisNumberFormat.compact(-4_200, language: .en), "-4.2k")
        XCTAssertEqual(JarvisNumberFormat.compact(Double.nan, language: .en), "—")
    }
}
