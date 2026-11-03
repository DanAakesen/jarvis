import XCTest
@testable import JarvisCore

final class DeviceLocationSettingsTests: XCTestCase {
    func testBuildsValidRoundedLocationPatch() throws {
        let patch = try XCTUnwrap(DeviceLocationSettings.patch(city: " Aarhus ", latitude: 56.15721, longitude: 10.21076))
        XCTAssertEqual(patch.areas["location"]?["city"], .string("Aarhus"))
        XCTAssertEqual(patch.areas["location"]?["latitude"], .number(56.16))
        XCTAssertEqual(patch.areas["location"]?["longitude"], .number(10.21))
        XCTAssertNoThrow(try JarvisSettingsLogic.validateSettingsPatch(patch))
    }

    func testRejectsInvalidCoordinatesAndEmptyCity() {
        XCTAssertNil(DeviceLocationSettings.patch(city: "Aarhus", latitude: 91, longitude: 10))
        XCTAssertNil(DeviceLocationSettings.patch(city: "  ", latitude: 56, longitude: 10))
        XCTAssertNil(DeviceLocationSettings.patch(city: "Aarhus", latitude: .nan, longitude: 10))
    }
}
