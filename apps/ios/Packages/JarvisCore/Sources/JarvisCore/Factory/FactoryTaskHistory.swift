import Foundation

/// History is oldest-first. Its offset must not include events received from SSE.
public struct FactoryTaskHistory: Sendable {
    public let taskID: String
    public private(set) var nextOffset = 0
    public private(set) var hasMore = true
    public private(set) var streamCursor: String?
    private var records: [String: FactoryTaskEvent] = [:]

    public init(taskID: String) {
        self.taskID = taskID
    }

    public var events: [FactoryTaskEvent] {
        records.values.sorted {
            if $0.at != $1.at { return $0.at < $1.at }
            return (Int64($0.id) ?? 0) < (Int64($1.id) ?? 0)
        }
    }

    public var canLoadMore: Bool { hasMore && nextOffset <= 10_000 }

    public mutating func mergePage(_ events: [FactoryTaskEvent], offset: Int, limit: Int = 100) {
        guard offset == 0 || offset == nextOffset else { return }
        let end = offset + events.count
        if offset == nextOffset || end > nextOffset {
            nextOffset = end
            hasMore = events.count == limit
        }
        for event in events { merge(event) }
    }

    @discardableResult
    public mutating func receive(_ event: FactoryTaskEvent) -> Bool {
        guard event.taskId == taskID else { return false }
        let inserted = records[event.id] == nil
        merge(event)
        if (Int64(event.id) ?? 0) > (Int64(streamCursor ?? "0") ?? 0) {
            streamCursor = event.id
        }
        return inserted
    }

    private mutating func merge(_ event: FactoryTaskEvent) {
        guard event.taskId == nil || event.taskId == taskID else { return }
        if let existing = records[event.id], !existing.payloadTruncated && event.payloadTruncated { return }
        records[event.id] = event
    }
}
