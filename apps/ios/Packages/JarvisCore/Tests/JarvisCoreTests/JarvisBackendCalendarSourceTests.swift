import Foundation
import XCTest
@testable import JarvisCore

final class JarvisBackendCalendarSourceTests: XCTestCase {
    func testReadsTimedAndAllDayEventsFromTheBackendRoute() async throws {
        let transport = try FixtureTransport(scenario: Data(scenario.utf8))
        let source = JarvisBackendCalendarSource(client: try makeClient(transport))
        let from = Date(timeIntervalSince1970: 1_800_000_000)
        let entries = try await source.entries(from: from, to: from.addingTimeInterval(86_400))

        XCTAssertEqual(entries.map(\.title), ["Dentist", "Holiday"])
        XCTAssertEqual(entries[0].location, "Clinic")
        XCTAssertEqual(entries[0].end.timeIntervalSince(entries[0].start), 3600)
        XCTAssertEqual(entries[1].end.timeIntervalSince(entries[1].start), 86_400)
    }

    private func makeClient(_ transport: FixtureTransport) throws -> JarvisClient {
        try JarvisClient(
            configuration: JarvisClientConfiguration(
                baseURL: URL(string: "https://api.example.invalid/api")!,
                retryPolicy: RetryPolicy(maximumRetries: 0)
            ),
            transport: transport,
            tokenStore: CalendarTokenStore(),
            accessTokenProvider: CalendarTokenProvider()
        )
    }
}

private actor CalendarTokenStore: TokenStore {
    func read() async throws -> String? { "fixture.owner.token" }
    func write(_ token: String) async throws {}
    func delete() async throws {}
}

private actor CalendarTokenProvider: AccessTokenProvider {
    func currentToken(for request: HTTPRequest) async throws -> String { "fixture.entra.token" }
    func requestSignIn() async {}
}

private let scenario = #"""
{
  "version": 1,
  "interactions": [
    {
      "method": "GET",
      "path": "/api/calendar/events",
      "query": {"from": "2027-01-15T08:00:00Z", "to": "2027-01-16T08:00:00Z"},
      "response": {
        "statusCode": 200,
        "body": {
          "timeZone": "Europe/Copenhagen",
          "truncated": false,
          "events": [
            {"id": "a", "subject": "Dentist", "start": "2027-01-15T08:00:00.000Z",
             "end": "2027-01-15T09:00:00.000Z", "location": "Clinic"},
            {"id": "b", "subject": "Holiday", "start": "2027-01-15", "end": "2027-01-16", "allDay": true}
          ]
        }
      }
    }
  ]
}
"""#
