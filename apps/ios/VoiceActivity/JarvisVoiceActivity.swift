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
        } dynamicIsland: { _ in
            // WidgetKit requires this builder; the Island surface is not part of P15-34.
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { EmptyView() }
            } compactLeading: {
                EmptyView()
            } compactTrailing: {
                EmptyView()
            } minimal: {
                EmptyView()
            }
        }
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
                    Text(text(VoiceLiveActivityCopy(rawValue: state.phase.rawValue) ?? .listening))
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
