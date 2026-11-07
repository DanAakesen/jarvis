import AppIntents
import JarvisCore
import SwiftUI
import WidgetKit

private let statusOrder: [JarvisFactoryWidgetData.Status] = [.running, .awaiting, .review, .failed]

private func title(_ status: JarvisFactoryWidgetData.Status) -> JarvisWidgetCopy {
    switch status {
    case .running: .running
    case .awaiting: .awaiting
    case .review: .review
    case .failed: .failed
    }
}

private func staleText(_ data: JarvisFactoryWidgetData, stale: Bool, language: JarvisAppLanguage) -> String? {
    stale ? JarvisWidgetFormat.updated(data.generatedAt, language: language) : nil
}

private let factorySymbol = "chevron.left.forwardslash.chevron.right"

/// Status list (small): four rows with a dot, label and count.
struct JarvisFactoryStatusWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.factory, language: language, emptyCopy: .emptyFactory) { data, stale in
            VStack(alignment: .leading, spacing: 6) {
                JarvisWidgetHeader(
                    symbol: factorySymbol, title: JarvisWidgetCopy.factory.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                Spacer(minLength: 0)
                ForEach(statusOrder, id: \.self) { status in
                    HStack(spacing: 6) {
                        Circle().fill(JarvisWidgetPalette.status(status)).frame(width: 8, height: 8)
                            .accessibilityHidden(true)
                        Text(title(status).text(language: language))
                            .font(.caption)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 2)
                        Text("\(data.count(status))").font(.caption.weight(.bold))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .jarvisWidgetSurface()
    }
}

/// Done chart (small): finished tasks in the week and tasks done per day.
struct JarvisFactoryDoneWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.factory, language: language, emptyCopy: .emptyFactory) { data, stale in
            VStack(alignment: .leading, spacing: 4) {
                JarvisWidgetHeader(
                    symbol: factorySymbol, title: JarvisWidgetCopy.factory.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(data.doneTotal)").font(.title.weight(.bold))
                    Text(JarvisWidgetCopy.done.text(language: language)).font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText)
                }
                JarvisWidgetBarChart(
                    values: data.doneLast7Days,
                    labels: JarvisWidgetFormat.dayLetters(endingOn: data.lastDay, language: language),
                    accessibilityText: "\(data.doneTotal) \(JarvisWidgetCopy.done.text(language: language)): \(data.doneLast7Days.map(String.init).joined(separator: ", "))"
                )
            }
        }
        .jarvisWidgetSurface()
    }
}

/// Four bordered count cells; the failed cell uses the red status colour.
private struct JarvisFactoryCountCells: View {
    let data: JarvisFactoryWidgetData
    let language: JarvisAppLanguage
    var compact = false

    var body: some View {
        HStack(spacing: 6) {
            ForEach(statusOrder, id: \.self) { status in
                let failed = status == .failed
                Group {
                    if compact {
                        HStack(spacing: 4) {
                            count(status, failed: failed).font(.subheadline.weight(.bold))
                            label(status).lineLimit(2)
                        }
                    } else {
                        VStack(spacing: 1) {
                            count(status, failed: failed).font(.title3.weight(.bold))
                            label(status).lineLimit(1)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: compact ? 22 : nil)
                .padding(.horizontal, compact ? 4 : 0)
                .padding(.vertical, compact ? 3 : 6)
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(failed ? JarvisWidgetPalette.status(.failed) : Color.secondary.opacity(0.35), lineWidth: 1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("widget.factory.count.\(status.rawValue)")
            }
        }
    }

    private func count(_ status: JarvisFactoryWidgetData.Status, failed: Bool) -> some View {
        Text("\(data.count(status))")
            .foregroundStyle(failed ? JarvisWidgetPalette.status(.failed) : .primary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }

    private func label(_ status: JarvisFactoryWidgetData.Status) -> some View {
        Text(title(status).text(language: language))
            .font(.system(size: 9))
            .foregroundStyle(JarvisWidgetPalette.secondaryText)
            .minimumScaleFactor(0.8)
    }
}

/// A task: title, one line of status text and, where the task allows it, one immediate action as a bare icon.
private struct JarvisFactoryTaskRow: View {
    let task: JarvisFactoryWidgetData.Task
    let language: JarvisAppLanguage
    var compact = false

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(JarvisWidgetPalette.status(task.status)).frame(width: 7, height: 7)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(task.title).font(compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold)).lineLimit(1)
                Text(task.detail).font(compact ? .caption2 : .caption).foregroundStyle(JarvisWidgetPalette.secondaryText).lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("widget.factory.task.\(task.id)")
            Spacer(minLength: 4)
            if let action = task.action { actionButton(action) }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: JarvisFactoryWidgetData.Action) -> some View {
        switch action {
        case .approve:
            Button(intent: ApproveFactoryTaskIntent(targetID: task.id)) { icon("checkmark", .approve) }
                .buttonStyle(.plain)
        case .pause:
            Button(intent: PauseFactoryTaskIntent(targetID: task.id)) { icon("pause", .pause) }
                .buttonStyle(.plain)
        case .resume:
            Button(intent: ResumeFactoryTaskIntent(targetID: task.id)) { icon("play", .resume) }
                .buttonStyle(.plain)
        case .retry:
            Button(intent: RetryFactoryTaskIntent(targetID: task.id)) { icon("arrow.clockwise", .retry) }
                .buttonStyle(.plain)
        }
    }

    private func icon(_ symbol: String, _ copy: JarvisWidgetCopy) -> some View {
        Image(systemName: symbol)
            .font(.body.weight(.semibold))
            .foregroundStyle(.orange)
            .widgetAccentable()
            .frame(width: 32, height: 32)
            .accessibilityLabel("\(copy.text(language: language)), \(task.title)")
    }
}

/// Medium: four count cells and two task rows. No footer row.
struct JarvisFactoryMediumWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.factory, language: language, emptyCopy: .emptyFactory) { data, stale in
            VStack(alignment: .leading, spacing: 4) {
                JarvisWidgetHeader(
                    symbol: factorySymbol, title: JarvisWidgetCopy.factory.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                JarvisFactoryCountCells(data: data, language: language, compact: true)
                ForEach(data.tasks.prefix(2)) { JarvisFactoryTaskRow(task: $0, language: language, compact: true) }
                if data.tasks.isEmpty {
                    Text(JarvisWidgetCopy.noTasks.text(language: language)).font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .jarvisWidgetSurface()
    }
}

/// Large: heading, the count cells and up to five task rows.
struct JarvisFactoryLargeWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.factory, language: language, emptyCopy: .emptyFactory) { data, stale in
            VStack(alignment: .leading, spacing: 10) {
                JarvisWidgetHeader(
                    symbol: factorySymbol, title: JarvisWidgetCopy.softwareFactory.text(language: language),
                    staleText: staleText(data, stale: stale, language: language)
                )
                JarvisFactoryCountCells(data: data, language: language)
                ForEach(data.tasks.prefix(5)) { JarvisFactoryTaskRow(task: $0, language: language) }
                if data.tasks.isEmpty {
                    Text(JarvisWidgetCopy.noTasks.text(language: language)).font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText)
                }
                Spacer(minLength: 0)
            }
        }
        .jarvisWidgetSurface()
    }
}
