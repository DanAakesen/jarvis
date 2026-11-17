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
