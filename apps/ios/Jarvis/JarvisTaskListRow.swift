import Foundation
import JarvisCore
import SwiftUI

/// Render vault emphasis as text without changing the task's stored Markdown or write identity.
enum JarvisTaskTitle {
    static func formatted(_ source: String) -> AttributedString {
        var title = (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(source)
        // The row opens task details; links in a title must not create nested navigation actions.
        title.link = nil
        return title
    }

    static func plain(_ source: String) -> String {
        String(formatted(source).characters)
    }
}

/// Shared task anatomy, inside a native List so swipe completion remains available.
struct JarvisTaskListRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 20
    @ScaledMetric(relativeTo: .subheadline) private var maximumDueWidth: CGFloat = 120
    let task: VaultTask
    let copy: JarvisNotesCopy
    let today: String
    let isFirst: Bool
    let isLast: Bool
    var accessibilityPrefix = "notes.task"
    let onOpen: () -> Void

    private var priorityColor: Color {
        switch task.priority {
        case .high: .red
        case .medium: JarvisDesignTokens.primaryAccent
        case .normal: .secondary
        }
    }

    private var priority: String {
        switch task.priority {
        case .high: copy.priorityHigh
        case .medium: copy.priorityMedium
        case .normal: copy.priorityNormal
        }
    }

    private var scope: String { task.scope == .work ? copy.work : copy.personal }
    private var overdue: Bool { task.dueDate.map { $0 < today } ?? false }

    private var due: String? {
        let time = task.dueTime.map { JarvisNotesLocalization.formattedDueTime($0, language: copy.language) }
        guard let day = task.dueDate, day != today else { return time }
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.calendar = Calendar(identifier: .gregorian)
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "yyyy-MM-dd"
        let date: String
        if let value = input.date(from: day) {
            let output = DateFormatter()
            output.locale = copy.language.locale
            output.calendar = input.calendar
            output.timeZone = input.timeZone
            output.setLocalizedDateFormatFromTemplate(day.prefix(4) == today.prefix(4) ? "EEE d MMM" : "d MMM yyyy")
            date = output.string(from: value)
        } else {
            date = day
        }
        return [date, time].compactMap { $0 }.joined(separator: " ")
    }

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: isFirst ? JarvisDesignTokens.surfaceRadius : 0,
            bottomLeadingRadius: isLast ? JarvisDesignTokens.surfaceRadius : 0,
            bottomTrailingRadius: isLast ? JarvisDesignTokens.surfaceRadius : 0,
            topTrailingRadius: isFirst ? JarvisDesignTokens.surfaceRadius : 0
        )
    }

    var body: some View {
        JarvisRowButton(identifier: "\(accessibilityPrefix).open", action: onOpen) {
            HStack(alignment: .center, spacing: JarvisPageHeaderMetrics.spacing) {
                Image(systemName: "checklist")
                    .font(.system(size: iconSize, weight: .regular))
                    .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    .frame(width: iconSize + JarvisPageHeaderMetrics.rowLineSpacing,
                           height: iconSize + JarvisPageHeaderMetrics.rowLineSpacing)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                    title
                    if dynamicTypeSize.isAccessibilitySize {
                        metadata
                        dueLabel
                    } else {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            metadata
                            Spacer(minLength: JarvisPageHeaderMetrics.actionSpacing)
                            dueLabel
                                .frame(maxWidth: maximumDueWidth, alignment: .trailing)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(minHeight: JarvisDesignTokens.controlMinimumHeight, alignment: .leading)
            .jarvisListRow(separator: !isLast)
        }
        .accessibilityLabel(JarvisTaskTitle.plain(task.text))
        .accessibilityValue([scope, priority, due].compactMap { $0 }.joined(separator: ", "))
        .background(.regularMaterial, in: shape)
        .clipShape(shape)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(accessibilityPrefix).row.\(task.id)")
    }

    private var title: some View {
        Text(JarvisTaskTitle.formatted(task.text))
            .font(.body)
            .foregroundStyle(.primary)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var metadata: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                scopeLabel
                priorityLabel
            }
            VStack(alignment: .leading, spacing: 2) {
                scopeLabel
                priorityLabel
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private var scopeLabel: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(task.scope == .work ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.notesFolderPersonal)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(scope).fixedSize()
        }
    }

    @ViewBuilder private var priorityLabel: some View {
        if task.priority != .normal {
            // List's automatic Label style can hide the word and give the symbol
            // an expanded row proposal. Keep this compact metadata explicit.
            HStack(spacing: 3) {
                Image(systemName: "flag").accessibilityHidden(true)
                Text(priority)
            }
            .foregroundStyle(priorityColor)
            .fixedSize()
        }
    }

    @ViewBuilder private var dueLabel: some View {
        if let due {
            Text(due)
                .font(.subheadline)
                .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
                .foregroundStyle(overdue ? Color.red : Color.secondary)
        }
    }
}
