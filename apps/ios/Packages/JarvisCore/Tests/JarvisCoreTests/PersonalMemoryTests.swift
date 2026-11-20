import XCTest
@testable import JarvisCore

final class PersonalMemoryTests: XCTestCase {
    func testMemoryOperationsAcceptOnlyNumericSQLIdentities() {
        XCTAssertTrue(JarvisSettingsLogic.validMemoryID("42"))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryID("0"))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryID("vault_UGVyc29uYWwvUHJlZmVyZW5jZXMubWQ"))
    }
}
