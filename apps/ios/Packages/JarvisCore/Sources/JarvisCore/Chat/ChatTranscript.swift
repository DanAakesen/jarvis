import Foundation

public enum ChatTranscript {
    public enum Refresh: Equatable, Sendable {
        case normal, afterTurn, liveUpdate

        /// A background history read isn't the result of a typed turn.
        public func failureNotice(_ message: @autoclosure () -> String) -> String? {
            self == .normal ? message() : nil
        }
    }

    public struct Order: Comparable, Sendable {
        private let id: String
        private let storedID: UInt64?
        private let localTime: Date

        public init(id: String, at: String) {
            self.id = id
            storedID = UInt64(id)
            if storedID == nil {
                localTime = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(at))
                    ?? (try? Date.ISO8601FormatStyle().parse(at)) ?? .distantPast
            } else {
                localTime = .distantPast
            }
        }

        public static func < (lhs: Self, rhs: Self) -> Bool {
            switch (lhs.storedID, rhs.storedID) {
            case let (left?, right?): return left != right ? left < right : lhs.id < rhs.id
            // The server orders persisted history by ID. Pending local messages sit after it.
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil):
                return lhs.localTime != rhs.localTime ? lhs.localTime < rhs.localTime : lhs.id < rhs.id
            }
        }
    }

    /// Upsert a bounded page into ordered history. A repeated page leaves the existing array untouched.
    public static func merging<Row: Equatable>(
        _ page: [Row], into history: [Row], by order: KeyPath<Row, Order>
    ) -> [Row]? {
        var merged = history
        var changed = false
        for row in page {
            let key = row[keyPath: order]
            var first = 0
            var end = merged.count
            while first < end {
                let middle = first + (end - first) / 2
                if merged[middle][keyPath: order] < key { first = middle + 1 }
                else { end = middle }
            }
            if first < merged.count, merged[first][keyPath: order] == key {
                guard merged[first] != row else { continue }
                merged[first] = row
            } else {
                merged.insert(row, at: first)
            }
            changed = true
        }
        return changed ? merged : nil
    }
}
