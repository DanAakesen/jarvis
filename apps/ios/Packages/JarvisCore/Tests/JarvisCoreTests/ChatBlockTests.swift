import Foundation
import XCTest
@testable import JarvisCore

final class ChatBlockTests: XCTestCase {
    private let locale = Locale(identifier: "en_GB")

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    private let forecastJSON = """
    {"version":1,"id":"5d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c11","type":"forecast","title":"Copenhagen · Fri 20 Nov",
     "source":{"label":"Open-Meteo","issuedAt":"2026-11-16T16:02:00.000Z"},
     "summary":"Friday in Copenhagen: mostly cloudy, high 9, low 5.",
     "data":{"place":"Copenhagen","date":"2026-11-20","conditions":"Mostly cloudy","symbol":"cloudy","highC":9,"lowC":5}}
    """

    private let chartJSON = """
    {"version":1,"id":"6d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c12","type":"chart","title":"Friday by hour",
     "source":{"label":"Open-Meteo","issuedAt":"2026-11-16T16:02:00Z","status":"partial","reason":"No reading for 11:00."},
     "summary":"Temperature peaks at 9 degrees at 14:00.",
     "data":{"xLabel":"Time of day","panels":[
       {"title":"Temperature","unit":"°C","kind":"line","series":[{"name":"Temperature","points":[{"x":"08:00","y":6},{"x":"11:00","y":null},{"x":"14:00","y":9}]}]},
       {"title":"Rain probability","unit":"%","kind":"bar","series":[{"name":"Rain probability","points":[{"x":"08:00","y":20},{"x":"14:00","y":37}]}]}]}}
    """

    func testDecodesForecastAndChartWithTheirOwnData() throws {
        let forecast = try decode(ChatBlock.self, forecastJSON)
        guard case .forecast(let value) = forecast.content else { return XCTFail("expected a forecast") }
        XCTAssertEqual(value.place, "Copenhagen")
        XCTAssertEqual(value.highC, 9)
        XCTAssertNil(value.rainChancePercent)
        XCTAssertEqual(forecast.source.issuedAt, "2026-11-16T16:02:00.000Z")

        let chart = try decode(ChatBlock.self, chartJSON)
        guard case .chart(let value) = chart.content else { return XCTFail("expected a chart") }
        XCTAssertEqual(value.panels.map(\.unit), ["°C", "%"])
        XCTAssertNil(value.panels[0].series[0].points[1].y)
        XCTAssertTrue(chart.source.isPartial)
    }

    func testRoundTripKeepsTheStoredBlock() throws {
        for json in [forecastJSON, chartJSON] {
            let block = try decode(ChatBlock.self, json)
            let again = try decode(ChatBlock.self, String(decoding: try JSONEncoder().encode(block), as: UTF8.self))
            XCTAssertEqual(again, block)
        }
    }

    func testViewBlockCarriesAnExistingRenderer() throws {
        let block = try decode(ChatBlock.self, """
        {"version":1,"id":"7d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c13","type":"view","title":"Packing list",
         "source":{"label":"Jarvis","issuedAt":"2026-11-16T16:02:00Z"},"summary":"Three items.",
         "data":{"view":{"version":1,"title":"Packing list","renderer":"list","source":{"id":"now","status":"complete"},
                         "data":{"items":[{"title":"Passport"}]}}}}
        """)
        guard case .view(.list(let envelope)) = block.content else { return XCTFail("expected a list view") }
        XCTAssertEqual(envelope.data.items.map(\.title), ["Passport"])
    }

    func testUnknownTypeVersionAndBrokenDataStayReadable() throws {
        let unknown = try decode(ChatBlock.self, forecastJSON.replacingOccurrences(of: "\"type\":\"forecast\"", with: "\"type\":\"hologram\""))
        let newer = try decode(ChatBlock.self, forecastJSON.replacingOccurrences(of: "\"version\":1", with: "\"version\":2"))
        let broken = try decode(ChatBlock.self, forecastJSON.replacingOccurrences(of: "\"date\":\"2026-11-20\",", with: ""))
        for block in [unknown, newer, broken] {
            guard case .unsupported = block.content else { return XCTFail("expected a fallback") }
            XCTAssertEqual(block.title, "Copenhagen · Fri 20 Nov")
            XCTAssertFalse(block.summary.isEmpty)
        }
    }

    func testOneBadBlockNeverCostsTheMessageOrThePage() throws {
        let message = try decode(ChatMessage.self, """
        {"id":"12","sessionId":"7","role":"jarvis","text":"Here.","model":null,"at":"2026-11-16T16:02:00Z",
         "blocks":[\(forecastJSON), {"nonsense":true}, \(chartJSON)]}
        """)
        XCTAssertEqual(message.blocks.map(\.type), ["forecast", "chart"])
        let plain = try decode(ChatMessage.self, """
        {"id":"13","sessionId":"7","role":"jarvis","text":"No block.","model":null,"at":"2026-11-16T16:02:00Z"}
        """)
        XCTAssertEqual(plain.blocks, [])
        let history = try decode(ChatHistoryPage.self, """
        {"messages":[{"id":"12","sessionId":"7","channel":"chat","language":"en","role":"jarvis","text":"Here.","model":null,
          "interrupted":false,"voiceMinutes":null,"at":"2026-11-16T16:02:00Z","toolCalls":[],"attachments":[],"blocks":[\(forecastJSON)]}],
         "nextCursor":null}
        """)
        XCTAssertEqual(history.messages.first?.blocks.first?.id, "5d0b2f9e-3c1a-4d57-8a5b-0f7f0b6a9c11")
    }

    func testFormatsDatesAndValuesWithoutShiftingThem() throws {
        XCTAssertEqual(ChatBlockFormatting.forecastDate("2026-11-20", locale: locale), "Fri 20 Nov")
        XCTAssertNil(ChatBlockFormatting.forecastDate("2026-02-30", locale: locale))
        let utc = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let copenhagen = try XCTUnwrap(TimeZone(identifier: "Europe/Copenhagen"))
        XCTAssertEqual(ChatBlockFormatting.issuedText("2026-11-16T16:02:00.000Z", locale: locale, timeZone: utc), "16 Nov, 16:02")
        XCTAssertEqual(ChatBlockFormatting.issuedText("2026-11-16T16:02:00Z", locale: locale, timeZone: copenhagen), "16 Nov, 17:02")
        XCTAssertEqual(ChatBlockFormatting.value(9, unit: "°C", locale: locale), "9°C")
        XCTAssertEqual(ChatBlockFormatting.value(37.5, unit: "%", locale: locale), "37.5%")
        XCTAssertEqual(ChatBlockFormatting.value(4.25, unit: "km", locale: locale), "4.3\u{00A0}km")
        XCTAssertEqual(ChatBlockFormatting.symbolName(for: "sparkles"), "cloud")
    }

    func testForecastShowsMissingValuesAsMissing() throws {
        let forecast = try decode(ChatBlockForecast.self, """
        {"place":"Copenhagen","date":"2026-11-20","conditions":"Fog","symbol":"fog","highC":9}
        """)
        XCTAssertEqual(forecast.highLowText(locale: locale), "9° / –")
    }

    func testPanelsKeepSeparateScalesAndExplicitGaps() throws {
        let block = try decode(ChatBlock.self, chartJSON)
        guard case .chart(let chart) = block.content else { return XCTFail("expected a chart") }
        let temperature = chart.panels[0]
        let rain = chart.panels[1]
        XCTAssertEqual(temperature.domain, 5...10)
        XCTAssertEqual(rain.domain, 0...40)
        XCTAssertTrue(temperature.hasMissingValues)
        XCTAssertFalse(rain.hasMissingValues)
        XCTAssertEqual(temperature.rows(locale: locale).map(\.values), [[6], [nil], [9]])
        XCTAssertEqual(
            temperature.dataDescription(xLabel: chart.xLabel, locale: locale, missing: "missing"),
            "Temperature (°C), Time of day. Temperature: 08:00 6°C, 11:00 missing, 14:00 9°C"
        )
        let text = block.plainText(locale: locale, missing: "missing", sourceLine: "Open-Meteo · Issued 16 Nov, 16:02")
        XCTAssertTrue(text.contains("Rain probability (%)"))
        XCTAssertTrue(text.hasSuffix("Open-Meteo · Issued 16 Nov, 16:02"))
    }

    func testTableListsEveryValueAndNamesTheMissingOnes() throws {
        let block = try decode(ChatBlock.self, chartJSON)
        guard case .chart(let chart) = block.content else { return XCTFail("expected a chart") }
        let table = chart.table(locale: locale, missing: "missing")
        XCTAssertEqual(table.header, ["Time of day", "Temperature (°C)", "Rain probability (%)"])
        XCTAssertEqual(table.rows, [
            ["08:00", "6°C", "20%"],
            ["11:00", "missing", "missing"],
            ["14:00", "9°C", "37%"],
        ])
    }

    func testBarsAndPercentagesStartAtZero() {
        func panel(_ kind: ChatBlockChartPanel.Kind, _ unit: String, _ values: [Double?]) -> ChatBlockChartPanel {
            ChatBlockChartPanel(
                title: "t", unit: unit, kind: kind,
                series: [ChatBlockChartSeries(name: "s", points: values.enumerated().map {
                    ChatBlockChartPoint(x: .number(Double($0.offset)), y: $0.element)
                })]
            )
        }
        XCTAssertEqual(panel(.bar, "mm", [3, 5]).domain, 0...5)
        XCTAssertEqual(panel(.bar, "kr", [-2, 5]).domain, -2...5)
        XCTAssertEqual(panel(.line, "%", [3]).domain, 0...10)
        XCTAssertEqual(panel(.line, "°C", [nil, nil]).domain, 0...1)
        XCTAssertEqual(panel(.line, "°C", [6, 6]).domain, 5...7)
    }
}
