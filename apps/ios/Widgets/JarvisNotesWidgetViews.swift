import JarvisCore
import SwiftUI
import WidgetKit

private let tasksSymbol = "checklist"

private func freshness(_ date: Date, stale: Bool, language: JarvisAppLanguage) -> String? {
    stale ? JarvisWidgetFormat.updated(date, language: language) : nil
}

/// The "Updated HH:mm" line a stale widget shows under its content.
struct JarvisWidgetFreshnessLine: View {
    let text: String?

    var body: some View {
        if let text {
            Text(text)
                .font(.caption2)
                .foregroundStyle(JarvisWidgetPalette.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

/// One list row in the Software Factory style: a small dot, the title and one muted line.
struct JarvisWidgetListRow: View {
    let dot: Color
    let title: String
    var detail: String?

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(dot).frame(width: 7, height: 7)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Rows inside one outlined, rounded container with hairline separators, as the Software Factory page lists them.
struct JarvisWidgetOutlinedList<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.secondary.opacity(0.35), lineWidth: 0.5)
            }
            .padding(.leading, 8)
    }
}

private extension JarvisNotesWidgetData {
    func taskRow(_ task: Task, language: JarvisAppLanguage) -> some View {
        JarvisWidgetListRow(
            dot: .orange, title: task.title, detail: JarvisWidgetPhrase.when(task, language: language)
        )
    }

}

/// A compact task and its due time share one readable row in the medium widget.
private struct JarvisWidgetCompactTaskRow: View {
    let task: JarvisNotesWidgetData.Task
    let language: JarvisAppLanguage

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Color.orange).frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(task.title)
                .font(.footnote.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            if let when = JarvisWidgetPhrase.when(task, language: language) {
                Text(when)
                    .font(.caption)
                    .foregroundStyle(JarvisWidgetPalette.secondaryText)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("widget.tasks.row.\(task.id)")
    }
}

/// "No tasks today", with the accent on "No tasks".
struct JarvisWidgetNoTasksPhrase: View {
    let language: JarvisAppLanguage

    var body: some View {
        (Text(JarvisWidgetCopy.noTasksTodayAccent.text(language: language)).foregroundStyle(.orange)
            + Text(" ")
            + Text(JarvisWidgetCopy.noTasksTodayRest.text(language: language)))
            .font(.title3.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Small: the bare task glyph, the number of tasks today and the next task with its time or date.
struct JarvisNotesSmallWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        Group {
            if case .empty = entry.notes {
                layout(language: language) { JarvisWidgetNoTasksPhrase(language: language) }
            } else {
                JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyTasks, skeletonRows: 3) { data, stale in
                    layout(language: language, freshness: freshness(data.generatedAt, stale: stale, language: language)) {
                        if let next = data.tasks.first, data.tasksToday > 0 {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .firstTextBaseline, spacing: 4) {
                                    Text("\(data.tasksToday)").font(.largeTitle.weight(.bold))
                                    Text(JarvisWidgetPhrase.label(
                                        data.tasksToday, one: .taskTodayOne, many: .taskTodayMany, language: language
                                    ))
                                    .font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText).lineLimit(1).minimumScaleFactor(0.7)
                                }
                                Text(next.title).font(.footnote.weight(.semibold)).lineLimit(1)
                                if let when = JarvisWidgetPhrase.when(next, language: language) {
                                    Text(when).font(.caption2).foregroundStyle(JarvisWidgetPalette.secondaryText).lineLimit(1)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        } else {
                            JarvisWidgetNoTasksPhrase(language: language)
                        }
                    }
                    .jarvisWidgetStaleAppearance(stale)
                }
            }
        }
        .jarvisWidgetSurface()
    }

    private func layout<Content: View>(
        language: JarvisAppLanguage, freshness: String? = nil, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            JarvisWidgetHeader(symbol: tasksSymbol, title: JarvisWidgetCopy.tasks.text(language: language))
            Spacer(minLength: 0)
            content()
            JarvisWidgetFreshnessLine(text: freshness)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Medium: a Tasks heading and up to three due-today tasks. No latest-note summary.
struct JarvisNotesMediumWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyTasks, skeletonRows: 3) { data, stale in
            VStack(alignment: .leading, spacing: 6) {
                JarvisWidgetHeader(
                    symbol: tasksSymbol, title: JarvisWidgetCopy.tasks.text(language: language),
                    staleText: freshness(data.generatedAt, stale: stale, language: language)
                )
                if data.tasks.isEmpty {
                    JarvisWidgetNoTasksPhrase(language: language)
                }
                ForEach(data.tasks.prefix(3)) { task in
                    JarvisWidgetCompactTaskRow(task: task, language: language)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .jarvisWidgetStaleAppearance(stale)
        }
        .jarvisWidgetSurface()
    }
}

/// Large: the same Tasks heading and up to five due-today tasks.
struct JarvisNotesLargeWidgetView: View {
    let entry: JarvisWidgetEntry

    private static let rowLimit = 5

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyTasks, skeletonRows: 5) { data, stale in
            let tasks = Array(data.tasks.prefix(Self.rowLimit))
            VStack(alignment: .leading, spacing: 10) {
                JarvisWidgetHeader(symbol: tasksSymbol, title: JarvisWidgetCopy.tasks.text(language: language))
                JarvisWidgetOutlinedList {
                    if tasks.isEmpty {
                        Text(JarvisWidgetPhrase.noTasksToday(language: language))
                            .font(.caption).foregroundStyle(JarvisWidgetPalette.secondaryText)
                    }
                    ForEach(tasks) { data.taskRow($0, language: language) }
                }
                Spacer(minLength: 0)
                JarvisWidgetFreshnessLine(text: freshness(data.generatedAt, stale: stale, language: language))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .jarvisWidgetStaleAppearance(stale)
        }
        .jarvisWidgetSurface()
    }
}
