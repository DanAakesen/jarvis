import JarvisCore
import SwiftUI
import WidgetKit

private func freshness(_ data: JarvisHomeWidgetData, stale: Bool, language: JarvisAppLanguage) -> String? {
    stale ? JarvisWidgetFormat.updated(data.generatedAt, language: language) : nil
}

/// The Now phrase beside the orb: the approvals needed, runs in progress or "All quiet". Orange when Dan is needed.
private struct JarvisHomeNowPhrase: View {
    let data: JarvisHomeWidgetData
    let language: JarvisAppLanguage
    var font: Font = .headline

    var body: some View {
        Text(JarvisWidgetPhrase.now(data, language: language))
            .font(font.weight(.semibold))
            .foregroundStyle(data.approvals > 0 ? Color.orange : Color.primary)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
    }
}

/// A count tile: bordered, the number in orange when it is above zero. Nothing is tappable inside the widget.
private struct JarvisHomeTile: View {
    let value: String
    let title: String
    var isAccent = false

    var body: some View {
        VStack(spacing: 1) {
            Text(value)
                .font(.title3.weight(.bold))
                .foregroundStyle(isAccent ? Color.orange : Color.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(title)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(isAccent ? Color.orange : Color.secondary.opacity(0.35), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Small: the orb (36 pt) and the Now phrase.
struct JarvisHomeSmallWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.home, language: language, emptyCopy: .allQuiet, skeletonRows: 2) { data, stale in
            VStack(alignment: .leading, spacing: 4) {
                JarvisWidgetOrb(size: 36)
                Spacer(minLength: 0)
                JarvisHomeNowPhrase(data: data, language: language, font: .title3)
                JarvisWidgetFreshnessLine(text: freshness(data, stale: stale, language: language))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(stale ? 0.55 : 1)
        }
        .jarvisWidgetSurface()
    }
}

/// Medium: the orb (40 pt) and the Now phrase, then three tiles: Approvals, Workouts done of target and Tasks.
struct JarvisHomeMediumWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.home, language: language, emptyCopy: .allQuiet, skeletonRows: 3) { data, stale in
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    JarvisWidgetOrb(size: 40)
                    JarvisHomeNowPhrase(data: data, language: language)
                    Spacer(minLength: 0)
                }
                HStack(spacing: 8) {
                    JarvisHomeTile(
                        value: "\(data.approvals)", title: JarvisWidgetCopy.approvals.text(language: language),
                        isAccent: data.approvals > 0
                    )
                    JarvisHomeTile(
                        value: workouts, title: JarvisWidgetCopy.workouts.text(language: language)
                    )
                    JarvisHomeTile(
                        value: tasks.map(String.init) ?? "–", title: JarvisWidgetCopy.tasks.text(language: language),
                        isAccent: (tasks ?? 0) > 0
                    )
                }
                Spacer(minLength: 0)
                JarvisWidgetFreshnessLine(text: freshness(data, stale: stale, language: language))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(stale ? 0.55 : 1)
        }
        .jarvisWidgetSurface()
    }

    /// Workouts done of target, from the Gym data; a dash while that data is missing.
    private var workouts: String {
        guard case .content(let gym, _) = entry.gym else { return "–" }
        return "\(gym.workoutsDone)/\(gym.workoutsTarget)"
    }

    private var tasks: Int? {
        guard case .content(let notes, _) = entry.notes else { return nil }
        return notes.tasksToday
    }
}

/// Large: the orb (52 pt) and the Now phrase in the header, then up to three rows: the top Software Factory item, the
/// Gym status and the first task today. A row whose data is missing is left out.
struct JarvisHomeLargeWidgetView: View {
    let entry: JarvisWidgetEntry

    var body: some View {
        let language = entry.language
        JarvisWidgetStateView(state: entry.home, language: language, emptyCopy: .allQuiet, skeletonRows: 4) { data, stale in
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    JarvisWidgetOrb(size: 52)
                    JarvisHomeNowPhrase(data: data, language: language, font: .title3)
                    Spacer(minLength: 0)
                }
                if factoryItem != nil || gym != nil || firstTask != nil {
                    JarvisWidgetOutlinedList {
                        rows(language: language)
                    }
                }
                Spacer(minLength: 0)
                JarvisWidgetFreshnessLine(text: freshness(data, stale: stale, language: language))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .opacity(stale ? 0.55 : 1)
        }
        .jarvisWidgetSurface()
    }

    private var factoryItem: JarvisFactoryWidgetData.Task? {
        guard case .content(let factory, _) = entry.factory else { return nil }
        return factory.tasks.first
    }

    private var gym: JarvisGymWidgetData? {
        guard case .content(let gym, _) = entry.gym else { return nil }
        return gym
    }

    private var firstTask: JarvisNotesWidgetData.Task? {
        guard case .content(let notes, _) = entry.notes else { return nil }
        return notes.tasks.first
    }

    @ViewBuilder
    private func rows(language: JarvisAppLanguage) -> some View {
        if let item = factoryItem {
            JarvisWidgetListRow(dot: JarvisWidgetPalette.status(item.status), title: item.title, detail: item.detail)
        }
        if let gym {
            let status = JarvisWidgetPhrase.gym(gym, language: language)
            JarvisWidgetListRow(dot: JarvisWidgetPalette.lift, title: status.title, detail: status.detail)
        }
        if let task = firstTask {
            JarvisWidgetListRow(
                dot: JarvisWidgetPalette.stone, title: task.title,
                detail: JarvisWidgetPhrase.when(task, language: language)
            )
        }
    }
}
