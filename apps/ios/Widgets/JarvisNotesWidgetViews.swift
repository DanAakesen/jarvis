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
                .foregroundStyle(.secondary)
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
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
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

    func noteRow(_ note: Note, now: Date, language: JarvisAppLanguage) -> some View {
        JarvisWidgetListRow(
            dot: JarvisWidgetPalette.stone, title: note.title,
            detail: JarvisWidgetPhrase.edited(note.editedAt, now: now, language: language)
        )
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
                JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyNotes, skeletonRows: 3) { data, stale in
                    layout(language: language, freshness: freshness(data.generatedAt, stale: stale, language: language)) {
                        if let next = data.tasks.first, data.tasksToday > 0 {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .firstTextBaseline, spacing: 4) {
                                    Text("\(data.tasksToday)").font(.largeTitle.weight(.bold))
                                    Text(JarvisWidgetPhrase.label(
                                        data.tasksToday, one: .taskTodayOne, many: .taskTodayMany, language: language
                                    ))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.7)
                                }
                                Text(next.title).font(.footnote.weight(.semibold)).lineLimit(1)
                                if let when = JarvisWidgetPhrase.when(next, language: language) {
                                    Text(when).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                JarvisWidgetNoTasksPhrase(language: language)
                                if let note = data.notes.first {
                                    Text(note.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                    .opacity(stale ? 0.55 : 1)
                }
            }
        }
        .jarvisWidgetSurface()
    }

    private func layout<Content: View>(
        language: JarvisAppLanguage, freshness: String? = nil, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: tasksSymbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.orange)
                .widgetAccentable()
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            content()
            JarvisWidgetFreshnessLine(text: freshness)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Medium: the shared heading, a data phrase and the next task or latest note.
struct JarvisNotesMediumWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyNotes, skeletonRows: 2) { data, stale in
            VStack(alignment: .leading, spacing: 10) {
                JarvisWidgetHeader(
                    symbol: tasksSymbol, title: JarvisWidgetCopy.notes.text(language: language),
                    staleText: freshness(data.generatedAt, stale: stale, language: language)
                )
                Text(JarvisWidgetPhrase.notes(data, language: language))
                    .font(.footnote)
                    .lineLimit(2)
                    .accessibilityIdentifier("widget.notes.summary")
                if let task = data.tasks.first {
                    data.taskRow(task, language: language)
                        .accessibilityIdentifier("widget.notes.next")
                } else if let note = data.notes.first {
                    data.noteRow(note, now: entry.date, language: language)
                        .accessibilityIdentifier("widget.notes.next")
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(stale ? 0.55 : 1)
        }
        .jarvisWidgetSurface()
    }
}

/// Large: the glyph and phrase in the header, today's tasks, then the latest notes, in one outlined list.
struct JarvisNotesLargeWidgetView: View {
    let entry: JarvisWidgetEntry

    private static let rowLimit = 5

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.notes, language: language, emptyCopy: .emptyNotes, skeletonRows: 6) { data, stale in
            let tasks = Array(data.tasks.prefix(3))
            let notes = Array(data.notes.prefix(Self.rowLimit - tasks.count))
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: tasksSymbol)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.orange)
                        .widgetAccentable()
                        .accessibilityHidden(true)
                    Text(JarvisWidgetPhrase.notes(data, language: language))
                        .font(.footnote.weight(.semibold))
                        .lineLimit(2)
                }
                JarvisWidgetOutlinedList {
                    if tasks.isEmpty {
                        Text(JarvisWidgetPhrase.noTasksToday(language: language))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(tasks) { data.taskRow($0, language: language) }
                    if !notes.isEmpty {
                        Text(JarvisWidgetCopy.latestNotes.text(language: language))
                            .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.top, tasks.isEmpty ? 0 : 2)
                    }
                    ForEach(notes) { data.noteRow($0, now: entry.date, language: language) }
                }
                Spacer(minLength: 0)
                JarvisWidgetFreshnessLine(text: freshness(data.generatedAt, stale: stale, language: language))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(stale ? 0.55 : 1)
        }
        .jarvisWidgetSurface()
    }
}
