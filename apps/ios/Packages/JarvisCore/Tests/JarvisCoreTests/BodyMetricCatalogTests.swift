import XCTest
@testable import JarvisCore

final class BodyMetricCatalogTests: XCTestCase {
    func testWeightUsesAliasWithNewestMeasurementDay() {
        let native: [String: JSONValue] = ["metric_name": .string("body_mass"), "last_date": .string("2026-01-01")]
        let imported: [String: JSONValue] = ["metric_name": .string("weight_body_mass"), "last_date": .string("2026-01-03")]
        let other: [String: JSONValue] = ["metric_name": .string("lean_body_mass"), "last_date": .string("2026-01-04")]
        for rows in [[native, imported, other], [other, imported, native]] {
            XCTAssertEqual(JarvisHealthLogic.latestBodyMetric(in: rows, matching: .weight), "weight_body_mass")
            XCTAssertNil(JarvisHealthLogic.latestBodyMetric(in: rows, matching: .fatPercent))
        }
    }
}
