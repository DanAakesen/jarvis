import JarvisCore
import SwiftUI

/// Workouts (donut by session type) and steps (ring and bars) with one range toggle.
struct JarvisTodayActivityCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool

    @ScaledMetric(relativeTo: .body) private var ringSize: CGFloat = 56
    @ScaledMetric(relativeTo: .body) private var donutSize: CGFloat = 100

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    private func color(_ session: JarvisGymSessionType) -> Color {
        switch session {
        case .chest: JarvisDesignTokens.primaryAccent
        case .back: JarvisDesignTokens.secondaryAccent
        case .arms: Color.cyan
        case .legs: JarvisDesignTokens.ambientGreen
        case .cardio: JarvisDesignTokens.ambientBlue
        case .strength: JarvisDesignTokens.primaryAccent
        case .other: Color.gray
        }
    }

    var body: some View {
        let display = model.display(language: language)
        VStack(alignment: .leading, spacing: 6) {
            header
            workoutsBlock(display)
            Divider().accessibilityHidden(true)
            Text(copy(.steps))
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            stepsBlock(display)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.activity")
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Text(copy(.workouts)).font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            rangeToggle
        }
    }

    private var rangeToggle: some View {
        JarvisPeriodSelector(
            title: copy(.period),
            identifierPrefix: "today.range",
            items: JarvisTodayRange.allCases.map {
                JarvisTabItem(tag: $0, title: $0.title(language: language), identifier: "today.range.\($0.rawValue)")
            },
            selection: Binding(
                get: { model.activity.range },
                set: { range in animate { model.activity.setRange(range) } }
            )
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
        } else {
            HStack(alignment: .center, spacing: 14) {
                donut(display)
                summary(display)
            }
        }
    }

    private func donut(_ display: JarvisTodayActivityDisplay) -> some View {
        let total = display.totalWorkouts
        return ZStack {
            Circle()
                .stroke(Color.primary.opacity(0.08), lineWidth: 10)
            if total > 0 {
                ForEach(arcs(display), id: \.session) { arc in
                    Circle()
                        .trim(from: arc.start, to: arc.end)
                        .stroke(
                            color(arc.session),
                            style: StrokeStyle(lineWidth: arc.session == display.centerSession ? 13 : 10)
                        )
                        .rotationEffect(.degrees(-90))
                        .opacity(display.centerSession == nil || arc.session == display.centerSession ? 1 : 0.35)
                }
            }
            VStack(spacing: 0) {
                Text("\(display.centerCount)")
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .monospacedDigit()
                if let selected = display.centerSession {
                    Text(selected.shortTitle(language: language))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                } else if total == 0 {
                    Text(JarvisTodayLocalization.string(.ofGoal, count: 1, language: language))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(12)
        }
        .padding(4)
        .frame(width: donutSize, height: donutSize)
        .contentShape(Circle())
        .gesture(
            SpatialTapGesture().onEnded { value in
                handleDonutTap(at: value.location, display: display)
            }
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(copy(.workoutsByType))
        .accessibilityValue("\(display.centerCount)")
        .accessibilityIdentifier("today.donut")
    }

    private struct Arc {
        let session: JarvisGymSessionType
        let start: CGFloat
        let end: CGFloat
    }

    private func arcs(_ display: JarvisTodayActivityDisplay) -> [Arc] {
        var cursor = 0.0
        var result: [Arc] = []
        for segment in display.segments where segment.count > 0 {
            let gap = display.segments.filter { $0.count > 0 }.count > 1 ? 0.012 : 0
            result.append(Arc(
                session: segment.session,
                start: CGFloat(cursor + gap / 2),
                end: CGFloat(max(cursor + gap / 2, cursor + segment.fraction - gap / 2))
            ))
            cursor += segment.fraction
        }
        return result
    }

    private func handleDonutTap(at point: CGPoint, display: JarvisTodayActivityDisplay) {
        let center = donutSize / 2
        let dx = point.x - center
        let dy = point.y - center
        var turn = atan2(dx, -dy) / (2 * .pi)
        if turn < 0 { turn += 1 }
        var cursor = 0.0
        for segment in display.segments where segment.count > 0 {
            cursor += segment.fraction
            if turn < cursor {
                animate { model.activity.toggleSegment(segment.session) }
                return
            }
        }
    }

    /// Active time and active kilocalories for the period: two large numbers split by a hairline, as tall as the donut.
    private func summary(_ display: JarvisTodayActivityDisplay) -> some View {
        VStack(spacing: 0) {
            summaryValue(
                JarvisTodayLocalization.durationText(minutes: display.activeMinutes, language: language),
                label: copy(.activeTime),
                identifier: "today.summary.time"
            )
            Divider().accessibilityHidden(true)
            summaryValue(
                JarvisNumberFormat.compact(display.activeKilocalories, language: language),
                label: copy(.activeKcal),
                identifier: "today.summary.kcal"
            )
        }
        .frame(maxWidth: .infinity)
        .frame(height: donutSize)
    }

    private func summaryValue(_ value: String, label: String, identifier: String) -> some View {
        VStack(spacing: 0) {
            Text(value)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                HStack(alignment: .center, spacing: 12) {
                    ring(display)
                    bars(display)
                        .frame(height: 48)
                }
                Text(display.caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityIdentifier("today.steps.caption")
            }
        }
    }

    private func ring(_ display: JarvisTodayActivityDisplay) -> some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.08), lineWidth: 6)
            Circle()
                .trim(from: 0, to: CGFloat(display.ringFraction))
                .stroke(
                    JarvisDesignTokens.primaryAccent,
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(JarvisNumberFormat.compact(display.ringSteps, language: language))
                    .font(.system(.caption, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
            .padding(8)
        }
        .padding(3)
        .frame(width: ringSize, height: ringSize)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(copy(.steps))
        .accessibilityValue(Text(verbatim: String(display.ringSteps)))
        .accessibilityIdentifier("today.steps.ring")
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
                Text("\(copy(.goal)) \(JarvisTodayActivity.stepGoal.formatted(.number.locale(language.locale)))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(.ultraThinMaterial, in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .offset(y: -height * goal / top)
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
                    .fill(selected ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent)
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
                ) { Task { await model.refresh() } }
            }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
    }
}
