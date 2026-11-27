import JarvisCore
import SwiftUI

/// Session totals and steps for the selected range, with details available on demand.
struct JarvisTodayActivityCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool

    @State private var expanded = false
    @State private var showAll = false
    @ScaledMetric(relativeTo: .title) private var summaryValueSize: CGFloat = 34

    private var isLargeText: Bool { dynamicTypeSize.isAccessibilitySize }

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    var body: some View {
        let display = model.display(language: language)
        VStack(alignment: .leading, spacing: 10) {
            header
            if showAll {
                VStack(alignment: .leading, spacing: 10) {
                    JarvisHistoryChart(metric: .training, client: model.healthClient)
                    Divider()
                    JarvisHistoryChart(metric: .steps, client: model.healthClient)
                }
                .id(model.now)
            } else {
                workoutsBlock(display)
                if !model.dailyActivity.isLoading, let issue = activityIssue(display) {
                    Text(issue).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("today.activity.issue")
                }
                Divider().accessibilityHidden(true)
                stepsBlock(display)
                if expanded {
                    let training = model.periodWorkouts.filter { JarvisHealthLogic.workoutKind($0.workoutType) != .other }
                    let walks = model.periodWorkouts.filter { ["walk", "walking", "52", "healthkit52"].contains(JarvisHealthLogic.normalizedWorkoutType($0.workoutType)) }
                    Text("Workouts include walks. The target is for gym sessions and runs.").font(.caption).foregroundStyle(.secondary)
                    Text("Gym & runs").font(.subheadline.weight(.semibold))
                    ForEach(Array(training.sorted { $0.performedAt > $1.performedAt }.enumerated()), id: \.offset) { _, workout in
                        HStack {
                            Text(workout.performedAt, format: .dateTime.day().month(.abbreviated)).foregroundStyle(.secondary)
                            Text(workout.session.shortTitle(language: language)).fontWeight(.semibold)
                            Spacer()
                            Text(workout.durationMinutes > 0 ? "\(Int(workout.durationMinutes.rounded())) min" : "—").foregroundStyle(.secondary)
                        }.font(.footnote)
                    }
                    if training.isEmpty { Text("No gym sessions or runs recorded").font(.footnote).foregroundStyle(.secondary) }
                    if !walks.isEmpty {
                        let timed = walks.map(\.durationMinutes).filter { $0 > 0 }
                        let minutes = (timed.count == walks.count ? "" : "≥ ") + "\(Int(timed.reduce(0, +).rounded())) min"
                        Text("\(walks.count) \(walks.count == 1 ? "walk" : "walks")" + (timed.isEmpty ? "" : " · " + minutes))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                JarvisDashboardDisclosure(title: expanded ? "Show less" : "Show more", expanded: expanded) {
                    animate { expanded.toggle() }
                }
            }
        }
        .padding([.horizontal, .top], JarvisPageHeaderMetrics.heroInset)
        .padding(.bottom, showAll ? JarvisPageHeaderMetrics.heroInset : JarvisPageHeaderMetrics.rowLineSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisDashboardSurface().environment(\.jarvisCardRole, "activity")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.activity")
    }

    // MARK: Header

    private var header: some View {
        JarvisHeroHeader("Activity") { rangeToggle }
    }

    private var rangeToggle: some View {
        JarvisHistoryPeriodSelector(
            title: copy(.period),
            identifierPrefix: "today.range",
            items: JarvisTodayRange.allCases.map {
                JarvisTabItem(tag: $0, title: $0.title(language: language), identifier: "today.range.\($0.rawValue)")
            },
            selection: Binding(
                get: { model.activity.range },
                set: { range in animate { model.activity.setRange(range) } }
            ), all: $showAll
        )
    }

    private func animate(_ change: () -> Void) {
        if reduceMotion {
            change()
        } else {
            withAnimation(.snappy(duration: 0.25), change)
        }
    }

    // MARK: Workouts

    @ViewBuilder
    private func workoutsBlock(_ display: JarvisTodayActivityDisplay) -> some View {
        if model.workouts.value == nil {
            if model.workouts.isLoading {
                stateRow(copy(.loading), systemImage: nil)
            } else {
                stateRow(
                    copy(model.workouts.failure == .unavailable ? .workoutsUnavailable : .loadFailed),
                    systemImage: "exclamationmark.triangle",
                    retry: model.workouts.failure != .unavailable
                )
            }
        }
        let sessions = model.periodWorkouts
        let durations = sessions.map(\.durationMinutes).filter { $0 > 0 }
        let minutes = durations.reduce(0, +)
        let target = model.periodWorkoutTarget.map { String(Int($0.rounded())) } ?? "—"
        let count = model.workouts.value == nil ? "—" : String(sessions.count)
        let duration = durations.isEmpty && (!sessions.isEmpty || model.workouts.value == nil) ? "—" :
            (durations.count < sessions.count ? "≥ " : "") + String(Int(minutes.rounded()))
        let layout = isLargeText ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout(alignment: .top))
        layout {
            summaryValue(count + " / " + target, label: copy(.workouts), identifier: "today.summary.workouts", tint: JarvisDesignTokens.primaryAccent)
            summaryValue(duration, label: "Workout minutes", identifier: "today.summary.time")
            summaryValue(activityValue(display.energyTotal), label: copy(.activeKcal), identifier: "today.summary.kcal")
        }
    }

    private func activityValue(_ total: JarvisActivityTotal) -> String {
        guard let raw = total.value, let value = Int(exactly: raw.rounded()) else { return "—" }
        return (total.availability == .partial ? "≥ " : "") + JarvisNumberFormat.compact(value, language: language)
    }

    private func activityIssue(_ display: JarvisTodayActivityDisplay) -> String? {
        let states = [display.energyTotal.availability, display.exerciseTotal.availability]
        if states.contains(.stale) { return copy(.activityStale) }
        if states.contains(.unavailable) { return copy(.activityUnavailable) }
        if states.contains(.partial) { return copy(.activityPartial) }
        return nil
    }

    private func summaryValue(_ value: String, label: String, identifier: String, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .foregroundStyle(tint)
                .font(.system(size: isLargeText ? summaryValueSize : 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(isLargeText ? nil : 1)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, isLargeText ? JarvisPageHeaderMetrics.actionSpacing : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(value)
        .accessibilityIdentifier(identifier)
    }

    // MARK: Steps

    @ViewBuilder
    private func stepsBlock(_ display: JarvisTodayActivityDisplay) -> some View {
        if model.steps.value == nil {
            if model.steps.isLoading {
                stateRow(copy(.loading), systemImage: nil)
            } else {
                stateRow(
                    copy(model.steps.failure == .unavailable ? .stepsUnavailable : .loadFailed),
                    systemImage: "figure.walk",
                    retry: model.steps.failure != .unavailable
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(copy(.steps)).fontWeight(.semibold)
                    Spacer()
                    Text(stepTotal(display)).fontWeight(.semibold).foregroundStyle(JarvisDesignTokens.primaryAccent)
                }.font(.subheadline)
                bars(display).frame(height: isLargeText ? 96 : 54)
                Text(display.caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier("today.steps.caption")
            }
        }
    }

    private func stepTotal(_ display: JarvisTodayActivityDisplay) -> String {
        if let label = display.ringLabel { return label + " · " + display.ringSteps.formatted() }
        if model.activity.range.isHourly { return display.ringSteps.formatted() }
        let recorded = display.bars.filter(\.isEnabled)
        guard !recorded.isEmpty else { return "—" }
        return (recorded.count < display.bars.count ? "≥ " : "") + recorded.map(\.value).reduce(0, +).formatted()
    }

    private func bars(_ display: JarvisTodayActivityDisplay) -> some View {
        let bars = display.bars
        let goal = CGFloat(JarvisTodayActivity.stepGoal)
        let top = max(goal * 1.15, CGFloat(bars.map(\.value).max() ?? 0) * 1.05)
        return GeometryReader { geometry in
            let height = geometry.size.height
            ZStack(alignment: .bottom) {
                HStack(alignment: .bottom, spacing: bars.count > 17 ? 1 : 3) {
                    ForEach(bars) { bar in
                        barButton(bar, selected: model.activity.selectedBar == bar.id, top: top, height: height)
                    }
                }
                Path { path in
                    let y = height - height * goal / top
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                }
                .stroke(
                    JarvisDesignTokens.secondaryAccent,
                    style: StrokeStyle(
                        lineWidth: JarvisDesignTokens.healthTargetLineWidth,
                        dash: JarvisDesignTokens.healthTargetLineDash
                    )
                )
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(model.activity.range.isHourly ? .stepsToday : .dailySteps))
        .accessibilityIdentifier("today.steps.chart")
    }

    private func barButton(_ bar: JarvisStepBar, selected: Bool, top: CGFloat, height: CGFloat) -> some View {
        let fill = height * CGFloat(bar.value) / top
        return Button {
            animate { model.activity.toggleBar(bar.id) }
        } label: {
            ZStack(alignment: .bottom) {
                Color.clear
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill((selected ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent).gradient)
                    .opacity(bar.isEnabled ? (selected || model.activity.selectedBar == nil ? 1 : 0.45) : 0.15)
                    .frame(height: max(2, fill))
            }
            .frame(maxWidth: .infinity, minHeight: 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!bar.isEnabled)
        .accessibilityLabel(bar.caption)
        .accessibilityValue("\(bar.value) \(copy(.stepsSuffix))")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("today.bar.\(bar.id)")
    }

    // MARK: States

    private func stateRow(_ text: String, systemImage: String?, retry: Bool = false) -> some View {
        HStack(spacing: 8) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                    .accessibilityHidden(true)
            } else {
                JarvisLoadingView()
            }
            Text(text).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if retry {
                JarvisIconButton(
                    title: copy(.retry),
                    systemImage: "arrow.clockwise",
                    identifier: "today.activity.retry"
                ) { Task { await model.refresh(force: true) } }
            }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
    }
}
