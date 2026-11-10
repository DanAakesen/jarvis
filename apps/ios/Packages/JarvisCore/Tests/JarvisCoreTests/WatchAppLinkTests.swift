import Foundation
import XCTest
@testable import JarvisCore

final class WatchAppLinkTests: XCTestCase {
    func testEveryComplicationLinkRoundTripsToItsOwnDestination() {
        for link in WatchAppLink.allCases {
            XCTAssertEqual(WatchAppLink(url: link.url), link)
        }
        XCTAssertEqual(WatchAppLink.logLift.url.absoluteString, "jarvis-watch://log-lift")
        XCTAssertEqual(WatchAppLink.tasks.url.absoluteString, "jarvis-watch://tasks")
    }

    func testExistingBodyFatAliasesRemainCompatible() throws {
        for value in ["jarvis-watch://bodyFat", "jarvis-watch://bodyfat", "jarvis-watch://body-fat/"] {
            XCTAssertEqual(WatchAppLink(url: try XCTUnwrap(URL(string: value))), .bodyFat)
        }
    }

    func testUntrustedURLsCannotSupplyCaptureInputOrInvokeWrites() throws {
        for value in [
            "https://log-lift", "jarvis-watch://saveLift", "jarvis-watch://createWatchTask",
            "jarvis-watch://log-lift?text=bench", "jarvis-watch://log-lift/save",
            "jarvis-watch://tasks#complete", "jarvis-watch://user@tasks", "jarvis-watch://tasks:80",
            "jarvis-watch:///log-lift", "jarvis-watch://unknown"
        ] {
            XCTAssertNil(WatchAppLink(url: try XCTUnwrap(URL(string: value))), value)
        }
    }
}
