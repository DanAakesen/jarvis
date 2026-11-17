import Foundation

/// Simulator-only history for the native captures of conversational blocks: a forecast reply, then a reply
/// with a temperature line and rain-probability bars. The values are synthetic and labelled as sample data.
enum JarvisChatBlockFixture {
    static var isEnabled: Bool {
#if DEBUG && targetEnvironment(simulator)
        ProcessInfo.processInfo.arguments.contains("--ui-test-chat-blocks")
#else
        false
#endif
    }

    private static let source: [String: Any] = ["label": "Sample data", "issuedAt": "2026-11-16T16:02:00.000Z"]
    private static let hours = ["08:00", "11:00", "14:00", "17:00", "20:00"]

    private static func points(_ values: [Double?]) -> [[String: Any]] {
        zip(hours, values).map { ["x": $0, "y": $1 ?? NSNull()] as [String: Any] }
    }

    static var history: [[String: Any]] {
        [
            message(id: "50", role: "dan", text: "Friday's forecast for Copenhagen?", at: "2026-11-16T16:01:50Z"),
            message(id: "51", role: "jarvis", text: "Here's the forecast for Copenhagen on Friday, 20 Nov.", at: "2026-11-16T16:02:00Z", blocks: [[
                "version": 1, "id": "5d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c11", "type": "forecast",
                "title": "Copenhagen · Fri 20 Nov", "source": source,
                "summary": "Friday 20 November in Copenhagen: mostly cloudy, high 9 degrees Celsius, low 5 degrees Celsius.",
                "data": ["place": "Copenhagen", "date": "2026-11-20", "conditions": "Mostly cloudy",
                         "symbol": "cloudy", "highC": 9, "lowC": 5],
            ]]),
            message(id: "52", role: "dan", text: "Show me temperature and rain through the day.", at: "2026-11-16T16:02:30Z"),
            message(id: "53", role: "jarvis", text: "Midday is the warmest and driest.", at: "2026-11-16T16:02:40Z", blocks: [[
                "version": 1, "id": "6d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c12", "type": "chart",
                "title": "Friday by hour", "source": source,
                "summary": "Temperature peaks at 9 degrees Celsius at 14:00. Rain probability is lowest, 10 percent, at 11:00 and 14:00, and highest, 40 percent, at 20:00.",
                "data": [
                    "xLabel": "Time of day",
                    "panels": [
                        ["title": "Temperature", "unit": "°C", "kind": "line",
                         "series": [["name": "Temperature", "points": points([6, 7, 9, 8, 6])]]],
                        ["title": "Rain probability", "unit": "%", "kind": "bar",
                         "series": [["name": "Rain probability", "points": points([20, 10, 10, 25, 40])]]],
                    ],
                ],
            ]]),
        ]
    }

    private static func message(
        id: String, role: String, text: String, at: String, blocks: [[String: Any]] = []
    ) -> [String: Any] {
        [
            "id": id, "sessionId": "12", "channel": "chat", "language": "en", "role": role, "text": text,
            "at": at, "interrupted": false, "toolCalls": [], "attachments": [], "blocks": blocks,
        ]
    }
}
