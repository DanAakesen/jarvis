import Foundation

/// A day remains 24 hourly positions; incomplete readings never stretch to the end of the day.
public struct WatchStepsPlot: Sendable {
    public let values: [Double]
    public let ceiling: Double
    public let goal: Double?
    public init(values: [Int], goal: Int?) {
        self.values = values.prefix(24).map { Double(max(0, $0)) }
        self.goal = goal.flatMap { $0 > 0 ? Double($0) : nil }
        ceiling = max(self.values.max() ?? 0, self.goal ?? 0, 1) * 1.12
    }
    public var goalHeight: Double? { goal.map { $0 / ceiling } }
    public func height(at hour: Double) -> Double? {
        guard hour.isFinite, hour >= 0, let last = values.indices.last, hour <= Double(last) else { return nil }
        let lower = Int(hour)
        let upper = min(lower + 1, last)
        let fraction = hour - Double(lower)
        return (values[lower] + (values[upper] - values[lower]) * fraction) / ceiling
    }
}
