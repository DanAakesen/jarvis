import Foundation
import XCTest
@testable import JarvisCore

final class VoiceEndpointTests: XCTestCase {
    func testAppLanguageIsSentOnlyWhenProvided() throws {
        let baseURL = URL(string: "https://api.example.invalid/api")!

        let danishURL = try VoiceEndpoint.url(baseURL: baseURL, appLanguage: .da)
        let defaultURL = try VoiceEndpoint.url(baseURL: baseURL)

        XCTAssertEqual(URLComponents(url: danishURL, resolvingAgainstBaseURL: false)?.queryItems, [
            URLQueryItem(name: "appLanguage", value: "da"),
        ])
        XCTAssertNil(URLComponents(url: defaultURL, resolvingAgainstBaseURL: false)?.query)
    }
}
