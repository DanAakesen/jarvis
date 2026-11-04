import Foundation

/// Reads Dan's calendar through the backend (`GET /calendar/events`), which reads the primary Google calendar.
public struct JarvisBackendCalendarSource: JarvisTodayCalendarSource {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func entries(from: Date, to: Date) async throws -> [JarvisTodayCalendarEntry] {
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
        return payload.events.compactMap { $0.entry(timeZone: payload.timeZone) }
    }

    private struct Payload: Decodable {
        let timeZone: String?
        let events: [Event]
    }

    private struct Event: Decodable {
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
                location: location?.isEmpty == false ? location : nil
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
