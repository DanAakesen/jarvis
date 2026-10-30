import Foundation

public struct ServerSentEvent: Equatable, Sendable {
    public let name: String
    public let data: String
    public let id: String?
    public let retry: UInt64?

    public init(name: String, data: String, id: String?, retry: UInt64?) {
        self.name = name
        self.data = data
        self.id = id
        self.retry = retry
    }
}

public struct SSEParser: Sendable {
    private var line: [UInt8] = []
    private var dataLines: [String] = []
    private var eventName: String?
    private var lastEventID: String?
    private var retryInterval: UInt64?
    private var hasPendingCarriageReturn = false
    private var isFinished = false

    public init() {}

    public mutating func append(_ bytes: Data) -> [ServerSentEvent] {
        guard !isFinished else { return [] }
        var events: [ServerSentEvent] = []
        for byte in bytes {
            if hasPendingCarriageReturn {
                processLine(into: &events)
                hasPendingCarriageReturn = false
                if byte == 0x0A { continue }
            }

            if byte == 0x0D {
                hasPendingCarriageReturn = true
            } else if byte == 0x0A {
                processLine(into: &events)
            } else {
                line.append(byte)
            }
        }
        return events
    }

    public mutating func finish() -> [ServerSentEvent] {
        guard !isFinished else { return [] }
        isFinished = true
        var events: [ServerSentEvent] = []
        if hasPendingCarriageReturn {
            processLine(into: &events)
            hasPendingCarriageReturn = false
        } else if !line.isEmpty {
            processLine(into: &events)
        }
        dispatch(into: &events)
        return events
    }

    private mutating func processLine(into events: inout [ServerSentEvent]) {
        defer { line.removeAll(keepingCapacity: true) }
        guard !line.isEmpty else {
            dispatch(into: &events)
            return
        }
        guard line.first != 0x3A else { return }

        let separator = line.firstIndex(of: 0x3A)
        let fieldBytes: ArraySlice<UInt8>
        var valueBytes: ArraySlice<UInt8>
        if let separator {
            fieldBytes = line[..<separator]
            valueBytes = line[line.index(after: separator)...]
        } else {
            fieldBytes = line[...]
            valueBytes = []
        }
        if valueBytes.first == 0x20 { valueBytes = valueBytes.dropFirst() }
        let field = String(decoding: fieldBytes, as: UTF8.self)
        let value = String(decoding: valueBytes, as: UTF8.self)

        switch field {
        case "data":
            dataLines.append(value)
        case "event":
            eventName = value
        case "id":
            if !valueBytes.contains(0) { lastEventID = value }
        case "retry":
            if !value.isEmpty, value.utf8.allSatisfy({ (0x30...0x39).contains($0) }) {
                retryInterval = UInt64(value)
            }
        default:
            break
        }
    }

    private mutating func dispatch(into events: inout [ServerSentEvent]) {
        guard !dataLines.isEmpty else {
            eventName = nil
            dataLines.removeAll(keepingCapacity: true)
            return
        }
        events.append(ServerSentEvent(
            name: eventName.flatMap { $0.isEmpty ? nil : $0 } ?? "message",
            data: dataLines.joined(separator: "\n"),
            id: lastEventID,
            retry: retryInterval
        ))
        eventName = nil
        dataLines.removeAll(keepingCapacity: true)
    }
}
