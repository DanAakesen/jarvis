import Foundation

/// Reads Dan's calendar through the backend (`GET /calendar/events`), which reads the primary Google calendar.
public struct JarvisBackendCalendarSource: JarvisTodayCalendarSource {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func entries(from: Date, to: Date) async throws -> [JarvisTodayCalendarEntry] {
        try await page(from: from, to: to).entries
    }

    public func page(from: Date, to: Date) async throws -> (entries: [JarvisTodayCalendarEntry], truncated: Bool) {
        let formatter = ISO8601DateFormatter()
        let response: HTTPResponse
        do {
            response = try await client.performAuthenticatedRequest(
                method: .get,
                path: ["calendar", "events"],
                queryItems: [
                    URLQueryItem(name: "from", value: formatter.string(from: from)),
                    URLQueryItem(name: "to", value: formatter.string(from: to)),
                ],
                idempotent: true
            )
        } catch let error as JarvisClientError {
            if error == .networkFailure || error == .timedOut { throw JarvisTodayDataError.offline }
            throw JarvisTodayDataError.failed
        }
        guard response.statusCode == 200,
              response.body.count <= 1024 * 1024,
              let payload = try? JSONDecoder().decode(Payload.self, from: response.body),
              payload.events.count <= 200 else {
            throw JarvisTodayDataError.failed
        }
        return (payload.events.compactMap { $0.entry(timeZone: payload.timeZone) }, payload.truncated == true)
    }

    private struct Payload: Decodable {
        let truncated: Bool?
        let timeZone: String?
        let events: [Event]
    }

    private struct Event: Decodable {
        let etag: String?
        let id: String
        let subject: String
        let start: String
        let end: String
        let allDay: Bool?
        let location: String?

        func entry(timeZone: String?) -> JarvisTodayCalendarEntry? {
            let range: (Date, Date)?
            if allDay == true {
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
                range = Self.day(start, calendar).flatMap { first in
                    Self.day(end, calendar).map { (first, $0) }
                }
            } else {
                range = Self.instant(start).flatMap { first in
                    Self.instant(end).map { (first, $0) }
                }
            }
            guard let range, !id.isEmpty, subject.count <= 500 else { return nil }
            return JarvisTodayCalendarEntry(
                id: id, title: subject, start: range.0, end: range.1,
                location: location?.isEmpty == false ? location : nil, allDay: allDay, etag: etag
            )
        }

        /// The backend writes `toISOString()` (with milliseconds); plain seconds are accepted too.
        private static func instant(_ value: String) -> Date? {
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        }

        private static func day(_ value: String, _ calendar: Calendar) -> Date? {
            let parts = value.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        }
    }
}

extension JarvisBackendCalendarSource {
    public func save(id: String, title: String, start: Date, end: Date, allDay: Bool,
                     calendar: Calendar, version: String?) async throws {
        struct Fields: Encodable {
            let id: String?
            let subject, start, end: String
            let allDay: Bool
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let fields = Fields(id: version == nil ? id : nil, subject: title,
                            start: allDay ? formatter.string(from: start) : start.ISO8601Format(),
                            end: allDay ? formatter.string(from: end) : end.ISO8601Format(), allDay: allDay)
        _ = try await client.performAuthenticatedRequest(
            method: version == nil ? .post : .patch,
            path: version == nil ? ["calendar", "events"] : ["calendar", "events", id],
            headers: version.map { ["If-Match": $0] } ?? [:], body: try JSONEncoder().encode(fields),
            idempotent: false
        )
    }

    public func delete(id: String, version: String) async throws {
        _ = try await client.performAuthenticatedRequest(method: .delete, path: ["calendar", "events", id],
            headers: ["If-Match": version], idempotent: false)
    }
}
