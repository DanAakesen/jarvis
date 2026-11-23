import Foundation
import XCTest
@testable import JarvisCore

final class WorkspaceCommandInterpreterTests: XCTestCase {
    private func command(_ operation: String, _ fields: [String: JSONValue] = [:]) -> WorkspaceCommand {
        WorkspaceCommand(commandId: "c1", operation: operation, fields: fields)
    }

    private func intent(_ command: WorkspaceCommand) -> WorkspaceCommandIntent? {
        if case .supported(let intent) = WorkspaceCommandInterpreter.interpret(command) { return intent }
        return nil
    }

    func testGeometryAndPlacementBringTheNamedViewForwardOnAPhone() {
        for operation in ["place", "move", "resize", "show", "focus", "restore"] {
            XCTAssertEqual(intent(command(operation, ["viewId": .string("plan")])), .focus(viewId: "plan"), operation)
        }
        XCTAssertEqual(
            intent(command("arrange", ["viewIds": .array([.string("b"), .string("a")]), "layout": .string("cascade")])),
            .focus(viewId: "b")
        )
    }

    func testArrangeWithoutAViewIsRefused() {
        guard case .refused = WorkspaceCommandInterpreter.interpret(command("arrange", ["viewIds": .array([])])) else {
            return XCTFail("expected a refusal")
        }
    }

    func testBulkOperationsHideOrForgetWhatIsOnScreen() {
        XCTAssertEqual(intent(command("minimise-all")), .dismissAll(forget: false))
        XCTAssertEqual(intent(command("close-all")), .dismissAll(forget: true))
        XCTAssertEqual(intent(command("restore-all")), .restoreLast)
    }

    func testFactoryNavigationKeepsAValidTaskIdAndDropsAnythingElse() {
        XCTAssertEqual(
            intent(command("navigate", ["page": .string("factory"), "taskId": .string("42")])),
            .navigate(page: "factory", taskId: "42")
        )
        XCTAssertEqual(
            intent(command("navigate", ["page": .string("factory"), "taskId": .string("0042")])),
            .navigate(page: "factory", taskId: nil)
        )
        XCTAssertEqual(
            intent(command("navigate", ["page": .string("notes"), "taskId": .string("42")])),
            .navigate(page: "notes", taskId: nil)
        )
    }

    func testAnOperationThePhoneDoesNotHaveIsStillRefused() {
        guard case .refused = WorkspaceCommandInterpreter.interpret(command("pin", ["viewId": .string("plan")])) else {
            return XCTFail("expected a refusal")
        }
    }

    func testAppleMapsInputAndBufferedArrival() throws {
        var fields: [String: JSONValue] = ["target": .string("phone"), "query": .string("Museum"),
            "origin": .string("Central Station"), "mode": .string("walking"), "arriveBy": .string("2026-11-23T09:00:00.000+01:00"),
            "bufferMinutes": .number(10)]
        let request = try XCTUnwrap(AppleMapsRequest(command: command("apple-maps", fields)))
        XCTAssertEqual(request.mode, "walking")
        XCTAssertEqual(request.arrivalDate, ISO8601DateFormatter().date(from: "2026-11-23T07:50:00Z"))
        fields["arriveBy"] = .string("tomorrow morning")
        XCTAssertNil(AppleMapsRequest(command: command("apple-maps", fields)))
        fields["arriveBy"] = nil
        fields["origin"] = nil
        fields["searchOnly"] = .bool(true)
        XCTAssertEqual(AppleMapsRequest(command: command("apple-maps", fields))?.searchOnly, true)
        fields["target"] = .string("web")
        XCTAssertNil(AppleMapsRequest(command: command("apple-maps", fields)))
    }

    func testAppleMapsNeedsAnOriginExceptForAnExplicitNamedSearch() {
        XCTAssertFalse(AppleMapsRequest(query: "pharmacy nearby").canSearchDestination(hasOrigin: false))
        let route = AppleMapsRequest(query: "museum", origin: "unresolved address")
        XCTAssertFalse(route.canSearchDestination(hasOrigin: false))
        XCTAssertTrue(route.canSearchDestination(hasOrigin: true))
        XCTAssertTrue(AppleMapsRequest(query: "Tivoli Copenhagen", searchOnly: true).canSearchDestination(hasOrigin: false))
    }

    func testAppleMapsSelectionUsesTheOriginalOrderAndEstimate() throws {
        let id = UUID().uuidString.lowercased()
        var fields: [String: JSONValue] = ["target": .string("phone"), "lookupId": .string(id), "ordinal": .number(2)]
        let selection = try XCTUnwrap(AppleMapsSelection(command: command("apple-maps", fields)))
        XCTAssertEqual(selection.lookupId, id)
        let places = ["First", "Second"].map { AppleMapsPlace(name: $0, address: "", latitude: 0, longitude: 0, travelSeconds: 490) }
        let original = AppleMapsResult(places: places, mode: "walking", observedAt: "time", bufferMinutes: 5)
        let chosen = try XCTUnwrap(original.selecting(ordinal: selection.ordinal))
        XCTAssertEqual(chosen.places, [places[1]])
        XCTAssertEqual(chosen.places[0].travelMinutes, 9)
        XCTAssertEqual(chosen.observedAt, original.observedAt)
        XCTAssertNil(original.selecting(ordinal: 3))
        fields["query"] = .string("changed search")
        XCTAssertNil(AppleMapsSelection(command: command("apple-maps", fields)))
        XCTAssertNil(AppleMapsRequest(command: command("apple-maps", fields)))
    }

    func testNearbyShopNeedsTheNameOnThePlaceAndADistanceWithinTheSearchRadius() throws {
        let fields: [String: JSONValue] = ["target": .string("phone"), "query": .string("North Loom"), "nearby": .string("name")]
        let shop = try XCTUnwrap(AppleMapsRequest(command: command("apple-maps", fields)))
        XCTAssertFalse(shop.canSearchDestination(hasOrigin: false))
        XCTAssertTrue(shop.acceptsNearbyPlace(name: "NORTH-LOOM Boutique", distanceMeters: 10_000))
        XCTAssertFalse(shop.acceptsNearbyPlace(name: "Store Road", distanceMeters: 220))
        XCTAssertFalse(shop.acceptsNearbyPlace(name: "North Looming", distanceMeters: 220))
        XCTAssertFalse(shop.acceptsNearbyPlace(name: "North Loom", distanceMeters: 850_000))
        XCTAssertFalse(shop.acceptsNearbyPlace(name: nil, distanceMeters: 100))
        var invalid = fields
        invalid["searchOnly"] = .bool(true)
        XCTAssertNil(AppleMapsRequest(command: command("apple-maps", invalid)))

        let category = AppleMapsRequest(query: "pharmacy", nearby: .category)
        XCTAssertTrue(category.acceptsNearbyPlace(name: "Central Apotek", distanceMeters: 100))
        XCTAssertFalse(category.acceptsNearbyPlace(name: "Central Apotek", distanceMeters: 10_001))
    }

    func testAppleMapsSamplesOnlyRealIndicesAndCoarsensTheDeviceOrigin() {
        XCTAssertEqual(AppleMapsRequest.sampleIndices(pointCount: 1), [0])
        let samples = AppleMapsRequest.sampleIndices(pointCount: 10_000)
        XCTAssertEqual(Set(samples).count, 64)
        XCTAssertEqual(samples.first, 0)
        XCTAssertEqual(samples.last, 9_999)
        let point = AppleMapsPoint(latitude: 56.12345678, longitude: 10.12345678)
        let coarse = AppleMapsRequest.approximate(point)
        XCTAssertEqual(coarse.latitude, 56.123)
        XCTAssertNotEqual(coarse.longitude, point.longitude)
        XCTAssertEqual(coarse, AppleMapsRequest.approximate(coarse))
    }

    func testAppleMapsReceiptContainsOnlyTheCountSpeechFlagAndReason() throws {
        let receipt = WorkspaceMapReceipt(matches: 2, spoken: true, reason: .needsOrigin)
        let wire = try JSONDecoder().decode([String: JSONValue].self, from: JSONEncoder().encode(receipt))
        XCTAssertEqual(wire, ["matches": .number(2), "spoken": .bool(true), "reason": .string("needs_origin")])
    }
}

final class GeneratedViewPresentationTests: XCTestCase {
    private func code(_ json: String) throws -> GeneratedCodeData {
        try JSONDecoder().decode(GeneratedCodeData.self, from: Data(json.utf8))
    }

    func testCodeLinesCountFromTheStartLineAndMarkTheHighlightedRange() throws {
        let data = try code(#"{"repo":"o/r","path":"a.swift","content":"one\ntwo\nthree\n","startLine":10,"highlight":[{"from":11,"to":11}]}"#)
        XCTAssertEqual(data.displayLines.map(\.number), [10, 11, 12])
        XCTAssertEqual(data.displayLines.map(\.isHighlighted), [false, true, false])
    }

    func testCodeTurnsTheBackendsEscapesBackIntoCharacters() throws {
        let data = try code(#"{"repo":"o&amp;r","path":"a.ts","content":"if (a &lt; b &amp;&amp; c) { s = &quot;x&quot; + &#39;y&#39; }"}"#)
        XCTAssertEqual(data.displayLines.first?.text, #"if (a < b && c) { s = "x" + 'y' }"#)
        XCTAssertEqual(data.location, "o&r · a.ts")
    }

    func testWindowsAndOldMacLineEndingsEachMakeOneRow() throws {
        let data = try code(#"{"repo":"","path":"a","content":"one\r\ntwo\rthree\n"}"#)
        XCTAssertEqual(data.displayLines.map(\.text), ["one", "two", "three"])
    }

    func testAnEscapedEscapeIsDecodedOnce() throws {
        let data = try code(#"{"repo":"","path":"a","content":"&amp;lt;"}"#)
        XCTAssertEqual(data.displayLines.first?.text, "&lt;")
    }

    func testForecastDataRowsShowAMissingValueAsMissing() throws {
        let json = #"{"place":"Copenhagen","date":"2026-11-20","conditions":"Cloudy","symbol":"cloudy","highC":9}"#
        let forecast = try JSONDecoder().decode(ChatBlockForecast.self, from: Data(json.utf8))
        let labels = ForecastDataLabels(place: "Place", date: "Date", conditions: "Conditions", high: "High", low: "Low", rainChance: "Rain")
        let rows = forecast.dataRows(labels: labels, dateText: "Fri 20 Nov", locale: Locale(identifier: "en_GB"), missing: "missing")
        XCTAssertEqual(rows, [
            ["Place", "Copenhagen"], ["Date", "Fri 20 Nov"], ["Conditions", "Cloudy"],
            ["High", "9°C"], ["Low", "missing"], ["Rain", "missing"],
        ])
    }
}

final class GeneratedViewRouteTests: XCTestCase {
    func testEveryRouteTheContractAllowsIsRecognised() {
        XCTAssertEqual(GeneratedViewRoute(route: "/"), .home)
        XCTAssertEqual(GeneratedViewRoute(route: "/usage"), .usage)
        XCTAssertEqual(GeneratedViewRoute(route: "/settings?section=voice"), .settings)
        XCTAssertEqual(GeneratedViewRoute(route: "/factory/tasks/42"), .factoryTask("42"))
        XCTAssertEqual(GeneratedViewRoute(route: "/factory/projects/7"), .factoryProject)
        XCTAssertEqual(GeneratedViewRoute(route: "/factory/releases/9"), .factoryRelease)
    }

    func testAnythingElseIsNotARoute() {
        for route in ["/notes", "/factory/tasks/0", "/factory/tasks/x", "/factory/tasks", "/factory/boards/1", "factory/tasks/1", ""] {
            XCTAssertNil(GeneratedViewRoute(route: route), route)
        }
    }
}
