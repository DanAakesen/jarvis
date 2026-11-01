import ActivityKit
import JarvisCore
import SwiftUI
import WidgetKit

@main
struct JarvisVoiceActivityBundle: WidgetBundle {
    var body: some Widget {
        JarvisVoiceActivity()
    }
}

struct JarvisVoiceActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: VoiceActivityAttributes.self) { context in
            VoiceLockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.86))
                .activitySystemActionForegroundColor(JarvisDesignTokens.liveActivityStone)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VoiceActivityOrbView(
                        diameter: 30,
                        language: context.attributes.appLanguage,
                        status: voiceActivityStatusText(
                            context.state.phase, language: context.attributes.appLanguage
                        )
                    )
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(VoiceLiveActivityCopy.title.text(language: context.attributes.appLanguage))
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text(voiceActivityStatusText(
                            context.state.phase, language: context.attributes.appLanguage
                        ))
                        .font(.caption)
                        .foregroundStyle(JarvisDesignTokens.liveActivityStone)
                        .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startedAt, style: .timer)
                        .monospacedDigit()
                        .font(.caption2)
                        .foregroundStyle(JarvisDesignTokens.liveActivityStone)
                        .frame(minWidth: 42, alignment: .trailing)
                        .accessibilityLabel(
                            VoiceLiveActivityCopy.elapsed.text(language: context.attributes.appLanguage)
                        )
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: JarvisDesignTokens.compactSpacing + 4) {
                        VoiceActivityWaveformView(
                            levels: context.state.waveform,
                            barCount: VoiceWaveform.sampleCount,
                            height: JarvisDesignTokens.liveActivityWaveformHeight,
                            language: context.attributes.appLanguage
                        )
                        HStack(spacing: JarvisDesignTokens.compactSpacing + 4) {
                            Button(intent: MuteVoiceActivityIntent(
                                sessionID: context.attributes.sessionID.uuidString,
                                muted: !context.state.isMuted
                            )) {
                                Label(
                                    (context.state.isMuted ? VoiceLiveActivityCopy.unmute : .mute)
                                        .text(language: context.attributes.appLanguage),
                                    systemImage: context.state.isMuted ? "mic" : "mic.slash"
                                )
                                .font(.caption)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(JarvisDesignTokens.liveActivityStone)
                            .background(.white.opacity(0.08), in: Capsule())

                            Button(intent: EndVoiceActivityIntent(
                                sessionID: context.attributes.sessionID.uuidString
                            )) {
                                Label(
                                    VoiceLiveActivityCopy.end.text(language: context.attributes.appLanguage),
                                    systemImage: "stop.fill"
                                )
                                .font(.caption)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, minHeight: 36)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(JarvisDesignTokens.liveActivityAccent)
                            .background(
                                JarvisDesignTokens.liveActivityAccent.opacity(0.12),
                                in: Capsule()
                            )
                        }
                    }
                }
            } compactLeading: {
                VoiceActivityOrbView(
                    diameter: 18,
                    language: context.attributes.appLanguage,
                    status: voiceActivityStatusText(
                        context.state.phase, language: context.attributes.appLanguage
                    )
                )
            } compactTrailing: {
                VoiceActivityWaveformView(
                    levels: context.state.waveform,
                    barCount: 6,
                    height: 12,
                    language: context.attributes.appLanguage
                )
                .frame(width: 22, height: 14)
            } minimal: {
                VoiceActivityOrbView(
                    diameter: 18,
                    language: context.attributes.appLanguage,
                    status: voiceActivityStatusText(
                        context.state.phase, language: context.attributes.appLanguage
                    )
                )
            }
            .keylineTint(JarvisDesignTokens.liveActivityAccent)
        }
    }
}

private func voiceActivityStatusText(
    _ phase: VoiceLiveActivityPhase, language: JarvisAppLanguage
) -> String {
    (VoiceLiveActivityCopy(rawValue: phase.rawValue) ?? .listening).text(language: language)
}

private struct VoiceActivityOrbView: View {
    let diameter: CGFloat
    let language: JarvisAppLanguage
    let status: String

    var body: some View {
        JarvisOrbView(activity: .calm, diameter: diameter, usesStaticFilaments: true)
            .frame(width: diameter, height: diameter)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(VoiceLiveActivityCopy.title.text(language: language))
            .accessibilityValue(status)
    }
}

private struct VoiceActivityWaveformView: View {
    let levels: [Double]
    let barCount: Int
    let height: CGFloat
    let language: JarvisAppLanguage

    private var barWidth: CGFloat { barCount == 6 ? 2 : 3 }
    private var spacing: CGFloat { barCount == 6 ? 2 : 3 }

    var body: some View {
        HStack(alignment: .center, spacing: spacing) {
            ForEach(0..<barCount, id: \.self) { index in
                let sample = levels.isEmpty
                    ? 0
                    : levels[min(index * levels.count / barCount, levels.count - 1)]
                RoundedRectangle(cornerRadius: 2)
                    .fill(JarvisDesignTokens.liveActivityAccent)
                    .frame(width: barWidth, height: max(2, height * CGFloat(min(1, max(0, sample)))))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(VoiceLiveActivityCopy.waveform.text(language: language))
    }
}

struct VoiceLockScreenView: View {
    let attributes: VoiceActivityAttributes
    let state: VoiceActivityAttributes.ContentState

    private func text(_ key: VoiceLiveActivityCopy) -> String {
        key.text(language: attributes.appLanguage)
    }

    var body: some View {
        VStack(spacing: JarvisDesignTokens.liveActivitySpacing) {
            HStack(spacing: JarvisDesignTokens.rowSpacing) {
                JarvisOrbView(
                    activity: .calm, diameter: JarvisDesignTokens.liveActivityOrbSize,
                    usesStaticFilaments: true
                )
                VStack(alignment: .leading, spacing: JarvisDesignTokens.compactSpacing) {
                    Text(text(.title)).font(.headline).foregroundStyle(.white)
                    Text(voiceActivityStatusText(state.phase, language: attributes.appLanguage))
                        .font(.subheadline)
                        .foregroundStyle(JarvisDesignTokens.liveActivityStone)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: JarvisDesignTokens.compactSpacing)
                Text(attributes.startedAt, style: .timer)
                    .monospacedDigit()
                    .font(.subheadline)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(JarvisDesignTokens.liveActivityStone)
                    .frame(maxWidth: 72)
                    .accessibilityLabel(text(.elapsed))
            }
            GeometryReader { geometry in
                HStack(spacing: 3) {
                    ForEach(0..<VoiceWaveform.sampleCount, id: \.self) { index in
                        let level = state.waveform.indices.contains(index) ? state.waveform[index] : 0
                        RoundedRectangle(cornerRadius: 2)
                            .fill(JarvisDesignTokens.liveActivityAccent)
                            .frame(
                                maxWidth: .infinity,
                                minHeight: 2,
                                maxHeight: max(2, geometry.size.height * min(1, max(0, level)))
                            )
                    }
                }
                .frame(height: geometry.size.height)
            }
            .frame(height: JarvisDesignTokens.liveActivityWaveformHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text(.waveform))

            ViewThatFits(in: .horizontal) {
                HStack(spacing: JarvisDesignTokens.rowSpacing) { controls }
                VStack(spacing: JarvisDesignTokens.compactSpacing) { controls }
            }
        }
        .padding(JarvisDesignTokens.liveActivityInset)
        .font(.subheadline)
        .environment(\.locale, attributes.appLanguage.locale)
    }

    @ViewBuilder
    private var controls: some View {
        Button(intent: MuteVoiceActivityIntent(
            sessionID: attributes.sessionID.uuidString, muted: !state.isMuted
        )) {
            Label(text(state.isMuted ? .unmute : .mute), systemImage: state.isMuted ? "mic" : "mic.slash")
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.controlMinimumHeight)
        }
        .buttonStyle(.plain)
        .foregroundStyle(JarvisDesignTokens.liveActivityStone)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceCornerRadius))

        Button(intent: EndVoiceActivityIntent(sessionID: attributes.sessionID.uuidString)) {
            Label(text(.end), systemImage: "stop.fill")
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.controlMinimumHeight)
        }
        .buttonStyle(.plain)
        .foregroundStyle(JarvisDesignTokens.liveActivityAccent)
        .background(JarvisDesignTokens.liveActivityAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceCornerRadius))
    }
}
