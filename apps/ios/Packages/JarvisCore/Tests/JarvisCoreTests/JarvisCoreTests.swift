import XCTest
@testable import JarvisCore

final class JarvisCoreTests: XCTestCase {
    func testPackageModuleIsAvailable() {
        XCTAssertEqual(String(describing: JarvisCore.self), "JarvisCore")
    }
}
