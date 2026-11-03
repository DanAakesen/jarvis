import JarvisCore
import SwiftUI

/// Workouts (donut by session type) and steps (ring and bars) with one range toggle.
struct JarvisTodayActivityCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let fixtureMode: Bool

    @ScaledMetric(relativeTo: .body) private var ringSize: CGFloat = 112
    @ScaledMetric(relativeTo: .body) private var donutSize: CGFloat = 96

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
        }
    }

    var body: some View {
        let display = model.display(language: language)
        VStack(alignment: .leading, spacing: 10) {
            header
            workoutsBlock(display)
            Divider().accessibilityHidden(true)
            Text(copy(.steps))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            stepsBlock(display)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("today.activity")
    }

    // MARK: Header

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                Text(copy(.workouts)).font(.headline).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                rangeToggle
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(copy(.workouts)).font(.headline).accessibilityAddTraits(.isHeader)
                rangeToggle
            }
        }
    }

    private var rangeToggle: some View {
        HStack(spacing: 0) {
            ForEach(JarvisTodayRange.allCases) { range in
                let selected = model.activity.range == range
                JarvisLabelledButton(
                    title: range.title(language: language),
                    identifier: "today.range.\(range.rawValue)",
                    isSelected: selected
                ) { animate { model.activity.setRange(range) } }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy(.period))
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
                legend(display)
            }
        }
    }

    private func donut(_ display: JarvisTodayActivityDisplay) -> some View {
        let total = display.totalWorkouts
        return ZStack {
            Circle()
                .stroke(Color.primary.opacity(0.08), lineWidth: 12)
            if total > 0 {
                ForEach(arcs(display), id: \.session) { arc in
                    Circle()
                        .trim(from: arc.start, to: arc.end)
                        .stroke(
                            color(arc.session),
                            style: StrokeStyle(lineWidth: arc.session == display.centerSession ? 16 : 12)
                        )
                        .rotationEffect(.degrees(-90))
                        .opacity(display.centerSession == nil || arc.session == display.centerSession ? 1 : 0.35)
                }
            }
            VStack(spacing: 0) {
                Text("\(display.centerCount)")
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .monospacedDigit()
                if let selected = display.centerSession {
                    Text(selected.shortTitle(language: language))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(14)
        }
        .padding(8)
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

    @ViewBuilder
    private func legend(_ display: JarvisTodayActivityDisplay) -> some View {
        let present = display.segments.filter { $0.count > 0 }
        if present.isEmpty {
            Text(copy(.workoutsEmpty))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(spacing: 0) {
                ForEach(present) { segment in
                    let selected = display.centerSession == segment.session
                    Button {
                        animate { model.activity.toggleSegment(segment.session) }
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(color(segment.session))
                                .frame(width: 10, height: 10)
                                .accessibilityHidden(true)
                            Text(segment.session.shortTitle(language: language))
                                .font(.subheadline)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Text("\(segment.count)")
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                        }
                        .foregroundStyle(selected ? JarvisDesignTokens.primaryAccent : Color.primary)
                        .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "\(segment.session.title(language: language)), \(segment.count)"
                    )
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityIdentifier("today.legend.\(segment.session.rawValue)")
                }
            }
        }
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
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 12) {
                    ring(display)
                    bars(display)
                        .frame(height: ringSize)
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
            Circle().stroke(Color.primary.opacity(0.08), lineWidth: 10)
            Circle()
                .trim(from: 0, to: CGFloat(display.ringFraction))
                .stroke(
                    JarvisDesignTokens.primaryAccent,
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(display.ringSteps.formatted(.number.locale(language.locale)))
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(display.ringLabel ?? copy(.stepsSoFar))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(16)
        }
        .padding(5)
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
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
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
                ProgressView()
            }
            Text(text).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if retry {
                JarvisIconButton(
                    title: copy(.retry),
                    systemImage: "arrow.clockwise",
                    identifier: "today.activity.retry",
                    chrome: .onGlass
                ) { Task { await model.refresh() } }
            }
        }
        .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
    }
}
