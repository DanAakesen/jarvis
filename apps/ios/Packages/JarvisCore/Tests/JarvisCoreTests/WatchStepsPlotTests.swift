import XCTest
@testable import JarvisCore

final class WatchStepsPlotTests: XCTestCase {
    func testGoalSharesScaleAndCanBeExceeded() throws {
        let below = WatchStepsPlot(values: [0, 1000, 4867], goal: 6000)
        XCTAssertLessThan(try XCTUnwrap(below.height(at: 2)), try XCTUnwrap(below.goalHeight))
        let above = WatchStepsPlot(values: [0, 7000], goal: 6000)
        XCTAssertGreaterThan(try XCTUnwrap(above.height(at: 1)), try XCTUnwrap(above.goalHeight))
        XCTAssertLessThan(try XCTUnwrap(above.height(at: 1)), 1)
    }
    func testMissingZeroAndInvalidGoalRemainDistinct() {
        let missing = WatchStepsPlot(values: [], goal: nil)
        XCTAssertNil(missing.height(at: 0))
        XCTAssertNil(missing.goalHeight)
        XCTAssertEqual(WatchStepsPlot(values: [0], goal: 0).height(at: 0), 0)
        XCTAssertNil(WatchStepsPlot(values: [0], goal: -1).goalHeight)
    }
    func testPartialDayDoesNotInventFutureReadings() throws {
        let plot = WatchStepsPlot(values: [0, 100, 300], goal: 6000)
        XCTAssertEqual(try XCTUnwrap(plot.height(at: 1.5)), 200 / plot.ceiling, accuracy: 0.000001)
        XCTAssertNil(plot.height(at: 2.01))
        XCTAssertNil(plot.height(at: -1))
        XCTAssertNil(plot.height(at: .nan))
        XCTAssertEqual(WatchStepsPlot(values: Array(repeating: 100, count: 30), goal: nil).values.count, 24)
    }
}
