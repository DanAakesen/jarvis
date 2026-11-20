import XCTest
@testable import JarvisCore

final class PersonalMemoryTests: XCTestCase {
    func testMemoryOperationsAcceptOnlyNumericSQLIdentities() {
        XCTAssertTrue(JarvisSettingsLogic.validMemoryID("42"))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryID("0"))
        XCTAssertFalse(JarvisSettingsLogic.validMemoryID("vault_UGVyc29uYWwvUHJlZmVyZW5jZXMubWQ"))
    }

    func testMemoryCacheScopeVersionsRawPaginationPages() {
        let scope = JarvisSettingsLogic.memoryCacheScope(queryDigest: "fixture", offset: 50)
        XCTAssertEqual(scope, "memory:v2:fixture:50")
        XCTAssertNotEqual(scope, "memory:fixture:50")
    }
}
