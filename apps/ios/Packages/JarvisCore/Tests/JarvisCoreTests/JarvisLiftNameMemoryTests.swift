import XCTest
@testable import JarvisCore

final class JarvisLiftNameMemoryTests: XCTestCase {
    func testBuiltInLiftsAreOfferedUntilThereIsHistory() {
        let memory = JarvisLiftNameMemory()
        let names = memory.suggestions(matching: "", language: .en).map(\.name)
        XCTAssertTrue(names.contains("Bench press"))
        XCTAssertEqual(memory.session(for: "bench press"), .chest)
        XCTAssertNil(memory.session(for: "Cable fly"))
    }

    func testRememberedNamesRankByUseAndFilterWhileTyping() {
        var memory = JarvisLiftNameMemory()
        let start = Date(timeIntervalSince1970: 1_000)
        memory.record(name: "Cable fly", session: .chest, at: start)
        memory.record(name: "Hip thrust", session: .legs, at: start.addingTimeInterval(10))
        memory.record(name: "hip THRUST", session: .legs, at: start.addingTimeInterval(20))
        XCTAssertEqual(memory.entries.count, 2)
        XCTAssertEqual(memory.suggestions(matching: "", language: .en).first?.name, "hip THRUST")
        XCTAssertEqual(memory.suggestions(matching: "fly", language: .en).map(\.name), ["Cable fly"])
        XCTAssertTrue(memory.suggestions(matching: "cable fly", language: .en).isEmpty, "An exact match needs no chip")
        XCTAssertEqual(memory.session(for: "Hip Thrust"), .legs)
    }

    func testMemorySurvivesARoundTripThroughDefaults() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "JarvisLiftNameMemoryTests"))
        defaults.removePersistentDomain(forName: "JarvisLiftNameMemoryTests")
        var memory = JarvisLiftNameMemory()
        memory.record(name: "Face pull", session: .back)
        memory.save(to: defaults)
        XCTAssertEqual(JarvisLiftNameMemory.load(from: defaults).entries.map(\.name), ["Face pull"])
    }
}
