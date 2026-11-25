import Charts
import JarvisCore
import SwiftUI

/// All-time data is fetched only while its card is open in the All period.
struct JarvisHistoryChart: View {
    let metric: JarvisHistoryMetric
    let client: JarvisHealthClient?
    @State private var history: JarvisMonthlyHistory?
    @State private var failed = false
    @State private var attempt = 0

    private var caption: String {
        switch metric {
        case .training: "Recorded workouts"
        case .steps: "Steps per recorded day"
        case .sleep: "Average sleep per recorded night"
        case .nutrition: "Average kcal per logged day"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let months = history?.months {
                if let first = months.first, let last = months.last {
                    let total = months.reduce(0) { $0 + $1.total }
                    let days = months.reduce(0) { $0 + $1.days }
                    let value = metric == .training ? total : total / Double(days)
                    Text(formatted(value)).font(.title2.bold()).foregroundStyle(JarvisDesignTokens.primaryAccent)
                    Text(caption).font(.subheadline)
                    Chart(months) { item in
                        BarMark(x: .value("Month", item.month),
                                y: .value(caption, metric == .training ? item.total : item.average))
                            .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    }
                    .chartXAxis(.hidden)
                    .frame(height: 90)
                    HStack {
                        Text(first.month)
                        Spacer()
                        if last.id != first.id { Text(last.month) }
                    }.font(.caption).foregroundStyle(.secondary)
                } else { Text("No recorded history").font(.footnote) }
            } else if failed {
                Text("History unavailable").font(.footnote)
                if client != nil { Button("Retry") { attempt += 1 } }
            } else { JarvisLoadingView(size: .inline) }
        }.frame(maxWidth: .infinity, alignment: .leading)
        .task(id: attempt) {
            failed = false
            do {
                guard let client else { failed = true; return }
                let result = try await client.dashboardHistory(metric)
                try Task.checkCancellation()
                history = result
            } catch { if !Task.isCancelled { failed = true } }
        }
    }

    private func formatted(_ value: Double) -> String {
        if metric == .sleep {
            let minutes = Int((value * 60).rounded())
            return "\(minutes / 60)h \(minutes % 60)m"
        }
        return value.formatted(.number.precision(.fractionLength(0)))
    }
}
