import Charts
import Foundation
import JarvisCore
import SwiftUI

/// Full-width plots retain the actual 30-day spacing, even when only one measurement exists.
struct JarvisHealthBodyChart: View {
    let metric: JarvisHealthMetricSeries
    let period: JarvisHealthPeriod
    let client: JarvisHealthClient?
    let capabilities: JarvisHealthCapabilities?
    let language: JarvisAppLanguage
    @State private var selectedID: Int?

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var trend: JarvisBodyTrend { JarvisBodyTrend(rows: metric.read.items, period: period) }
    private var reading: JarvisBodyTrend.Reading? {
        trend.readings.first { $0.id == selectedID } ?? trend.latest
    }
    private var identifier: String { "health.body.\(metric.metricName)" }

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.healthRowSpacing) {
            NavigationLink {
                JarvisHealthDetailView(client: client, capabilities: capabilities,
                    kind: .metric(metric.metricName, metric.title, period), language: language)
            } label: {
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    HStack {
                        Text(copy.text(metric.title)).font(.subheadline.weight(.semibold))
                        Spacer(minLength: JarvisDesignTokens.notesInlineSpacing)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    if let reading {
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .firstTextBaseline) {
                                value(reading)
                                Spacer(minLength: JarvisDesignTokens.notesInlineSpacing)
                                dateLabel(reading)
                            }
                            VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                                value(reading)
                                dateLabel(reading)
                            }
                        }
                    }
                }
                .foregroundStyle(.primary)
                .frame(minHeight: JarvisDesignTokens.controlMinimumHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint(copy.text(.measurements))
            .accessibilityIdentifier("\(identifier).details")

            if trend.readings.isEmpty {
                JarvisHealthStateLine(state: metric.read.state == .available ? .empty : metric.read.state,
                                      language: language)
            } else {
                JarvisBodyTrendPlot(trend: trend, period: period, title: copy.text(metric.title),
                                    language: language, selectedID: $selectedID)
                    .accessibilityIdentifier("\(identifier).chart")
                HStack(alignment: .top) {
                    Text(String(format: copy.text(trend.readings.count == 1 ? .oneMeasurement : .measurementCount),
                                trend.readings.count))
                    Spacer(minLength: 0)
                    if metric.read.hasMore || trend.excludesOtherUnits { Text(copy.text(.partial)) }
                    if metric.read.isStale { Text(copy.text(.stale)) }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
        .onChange(of: metric.read.items) { selectedID = nil }
    }

    private func value(_ reading: JarvisBodyTrend.Reading) -> some View {
        Text("\(formatNumber(reading.value, language: language)) \(reading.unit)")
            .font(.title3.weight(.semibold)).monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
    }

    private func dateLabel(_ reading: JarvisBodyTrend.Reading) -> some View {
        Text(JarvisHealthLocalization.formattedDate(reading.day, language: language))
            .font(.caption).foregroundStyle(.secondary)
            .fixedSize(horizontal: true, vertical: false)
    }
}

struct JarvisBodyTrendPlot: View {
    let trend: JarvisBodyTrend
    let period: JarvisHealthPeriod
    let title: String
    let language: JarvisAppLanguage
    @Binding var selectedID: Int?

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var start: Date { parseDate(period.startDate)! }
    private var end: Date { parseDate(period.endDate)! }
    private var ticks: [Date] { [start, start.addingTimeInterval(end.timeIntervalSince(start) / 2), end] }

    var body: some View {
        Chart {
            ForEach(trend.readings) { point in
                if trend.readings.count > 1 {
                    LineMark(x: .value(copy.text(.date), point.date), y: .value(title, point.value))
                        .interpolationMethod(.linear)
                        .lineStyle(StrokeStyle(lineWidth: JarvisDesignTokens.healthChartLineWidth,
                                               lineCap: .round, lineJoin: .round))
                        .foregroundStyle(JarvisDesignTokens.healthAccent)
                }
                PointMark(x: .value(copy.text(.date), point.date), y: .value(title, point.value))
                    .symbolSize(point.id == selectedID ? 64 : 28)
                    .foregroundStyle(JarvisDesignTokens.healthAccent)
            }
            if let point = trend.readings.first(where: { $0.id == selectedID }) {
                RuleMark(x: .value(copy.text(.date), point.date))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
        .chartXScale(domain: start...max(end, start.addingTimeInterval(86_400)))
        .chartYScale(domain: trend.domain)
        .chartXAxis {
            AxisMarks(values: ticks) { axis in
                if let date = axis.as(Date.self) {
                    AxisValueLabel(anchor: date == start ? .topLeading : date == end ? .topTrailing : .top) {
                        Text(shortDate(date))
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { axis in
                AxisGridLine().foregroundStyle(Color.secondary.opacity(0.15))
                AxisValueLabel {
                    if let value = axis.as(Double.self) {
                        Text(formatNumber(value, language: language))
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onTapGesture(coordinateSpace: .local) { location in
                        guard let frame = proxy.plotFrame else { return }
                        let plot = geometry[frame]
                        guard plot.contains(location),
                              let date: Date = proxy.value(atX: location.x - plot.minX),
                              let point = trend.nearest(to: date) else { return }
                        selectedID = selectedID == point.id ? nil : point.id
                    }
            }
        }
        .frame(height: JarvisDesignTokens.healthChartHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(accessibilitySummary)
        .accessibilityAdjustableAction { direction in
            guard !trend.readings.isEmpty else { return }
            let index = trend.readings.firstIndex { $0.id == selectedID } ?? trend.readings.count - 1
            switch direction {
            case .increment: selectedID = trend.readings[min(index + 1, trend.readings.count - 1)].id
            case .decrement: selectedID = trend.readings[max(index - 1, 0)].id
            @unknown default: break
            }
        }
    }
    private var accessibilitySummary: String {
        guard let point = trend.readings.first(where: { $0.id == selectedID }) ?? trend.latest else {
            return copy.text(.empty)
        }
        return "\(JarvisHealthLocalization.formattedDate(point.day, language: language)): \(formatNumber(point.value, language: language)) \(point.unit)"
    }

    private func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter.string(from: date)
    }

}
