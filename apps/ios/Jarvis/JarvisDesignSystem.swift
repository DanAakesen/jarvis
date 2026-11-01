import SwiftUI
import UIKit

enum JarvisDesignTokens {
    static let primaryAccent = adaptiveColor(
        light: UIColor(red: 180.0 / 255, green: 95.0 / 255, blue: 6.0 / 255, alpha: 1),
        dark: UIColor(red: 1, green: 180.0 / 255, blue: 92.0 / 255, alpha: 1)
    )
    static let primaryAccentForeground = adaptiveColor(
        light: .white,
        dark: UIColor(red: 29.0 / 255, green: 18.0 / 255, blue: 0, alpha: 1)
    )
    static let secondaryAccent = adaptiveColor(
        light: UIColor(red: 111.0 / 255, green: 101.0 / 255, blue: 81.0 / 255, alpha: 1),
        dark: UIColor(red: 201.0 / 255, green: 191.0 / 255, blue: 174.0 / 255, alpha: 1)
    )
    static let pageBackground = adaptiveColor(
        light: UIColor(red: 246.0 / 255, green: 240.0 / 255, blue: 230.0 / 255, alpha: 1),
        dark: UIColor(red: 7.0 / 255, green: 9.0 / 255, blue: 15.0 / 255, alpha: 1)
    )
    static let ambientCool = adaptiveColor(
        light: UIColor(red: 20.0 / 255, green: 118.0 / 255, blue: 141.0 / 255, alpha: 1),
        dark: UIColor(red: 82.0 / 255, green: 220.0 / 255, blue: 250.0 / 255, alpha: 1)
    )
    static let ambientWarm = adaptiveColor(
        light: UIColor(red: 232.0 / 255, green: 162.0 / 255, blue: 58.0 / 255, alpha: 1),
        dark: UIColor(red: 1, green: 180.0 / 255, blue: 92.0 / 255, alpha: 1)
    )
    static let ambientGreen = adaptiveColor(
        light: UIColor(red: 45.0 / 255, green: 179.0 / 255, blue: 93.0 / 255, alpha: 1),
        dark: UIColor(red: 61.0 / 255, green: 220.0 / 255, blue: 132.0 / 255, alpha: 1)
    )
    static let ambientBlue = adaptiveColor(
        light: UIColor(red: 47.0 / 255, green: 128.0 / 255, blue: 237.0 / 255, alpha: 1),
        dark: UIColor(red: 59.0 / 255, green: 139.0 / 255, blue: 255.0 / 255, alpha: 1)
    )

    static let controlMinimumHeight: CGFloat = 44
    static let contentInset: CGFloat = 20
    static let contentSpacing: CGFloat = 16
    static let rowSpacing: CGFloat = 12
    static let compactSpacing: CGFloat = 4
    static let iconLabelSpacing: CGFloat = 6
    static let timelineMarkerTopInset: CGFloat = 7
    static let surfaceCornerRadius: CGFloat = 16
    static let listRowVerticalInset: CGFloat = 12
    static let emptyStateHeight: CGFloat = 180
    static let searchDebounceMilliseconds: Int64 = 250
    static let openedFeedbackMilliseconds: Int64 = 1_600
    static let filterAnimationDuration: Double = 0.18
    static let chartHeight: CGFloat = 220
    static let chartAreaOpacity: Double = 0.16
    static let chartMinimumPointSpacing: CGFloat = 40
    static let chartMaximumWidth: CGFloat = 1_200
    static let timelineMarkerSize: CGFloat = 8
    static let chartSeriesColors: [Color] = [primaryAccent, .blue, .green, .orange, .purple]
    static let iconSize: CGFloat = 20
    static let sidebarWidthFraction: CGFloat = 0.74
    static let sidebarMaximumWidth: CGFloat = 320
    static let sidebarGestureStartFraction: CGFloat = 0.62
    static let sidebarGestureMinimumDistance: CGFloat = 8
    static let sidebarOpenThreshold: CGFloat = 0.5
    static let sidebarRowHeight: CGFloat = 52
    static let sidebarRowSpacing: CGFloat = 2
    static let sidebarRowLabelSpacing: CGFloat = 14
    static let sidebarHorizontalInset: CGFloat = 24
    static let sidebarVerticalInset: CGFloat = 16
    static let sidebarIconSize: CGFloat = 21
    static let sidebarIconColumnWidth: CGFloat = 25
    static let sidebarPressedOpacity: CGFloat = 0.58
    static let sidebarSpringResponse: CGFloat = 0.36
    static let sidebarSpringDamping: CGFloat = 0.88
    static let screenDimOpacity: CGFloat = 0.12
    static let screenBlurRadius: CGFloat = 4
    static let chatHorizontalInset: CGFloat = 16
    static let chatVerticalInset: CGFloat = 12
    static let chatMessageSpacing: CGFloat = 8
    static let chatMessageMaximumWidth: CGFloat = 360
    static let chatBubbleRadius: CGFloat = 22
    static let chatUserBubbleRadius: CGFloat = 24
    static let chatUserBubbleBorderOpacity: Double = 0.34
    static let chatUserBubbleBorderWidth: CGFloat = 1
    static let toolbarQuietActionFillOpacity: Double = 0.08
    static let toolbarQuietActionPressedOpacity: Double = 0.16
    static let chatComposerRadius: CGFloat = 24
    static let chatComposerSpacing: CGFloat = 10
    static let chatComposerIconSize: CGFloat = 20
    static let chatMinimumTapTarget: CGFloat = 44
    static let chatSheetCornerRadius: CGFloat = 28
    static let chatSheetRowSpacing: CGFloat = 16
    static let chatPlusMenuWidth: CGFloat = 272
    static let chatPlusMenuInset: CGFloat = 10
    static let chatPlusMenuSpacing: CGFloat = 2
    static let chatPlusMenuRowHeight: CGFloat = 44
    static let chatPlusMenuRadius: CGFloat = 22
    static let chatLivePreviewHeight: CGFloat = 126
    static let chatGlassInset: CGFloat = 12
    static let chatGlassOpacity: CGFloat = 0.16
    static let chatBadgeInset: CGFloat = 6
    static let chatModeWidthFraction: CGFloat = 0.28
    static let chatMessageAnimationDuration: Double = 0.18
    static let chatComposerMaximumLines = 5
    static let chatConfirmationSummaryLines = 3
    static let chatPhotoCompressionQuality: CGFloat = 0.88
    static let voiceOrbStrokeWidth: CGFloat = 1.5
    static let voiceOrbListeningPulse: CGFloat = 0.035
    static let voiceOrbThinkingPulse: CGFloat = 0.09
    static let voiceOrbSpeakingPulse: CGFloat = 0.05
    static let voiceOrbListeningDuration: Double = 2.8
    static let voiceOrbThinkingDuration: Double = 1.5
    static let voiceOrbSpeakingDuration: Double = 0.9
    static let voiceControlDiameter: CGFloat = 52
    static let voiceControlSpacing: CGFloat = 16
    static let voiceControlBottomInset: CGFloat = 24
    static let voiceCameraTileWidth: CGFloat = 122
    static let voiceCameraTileHeight: CGFloat = 164
    static let voiceCameraTileCornerRadius: CGFloat = 22
    static let voiceCameraTileInset: CGFloat = 18
    static let voiceCameraTileControlClearance: CGFloat = 108
    static let voiceCameraCloseButtonDiameter: CGFloat = 36
    static let voiceCameraShadowOpacity: CGFloat = 0.18
    static let voiceCameraShadowYOffset: CGFloat = 6
    static let voiceCameraFrameInterval = VoiceScreenShareContract.frameInterval
    static let voiceCameraMaximumFrameWidth = VoiceScreenShareContract.maximumFrameWidth
    static let voiceCameraMaximumFrameHeight = VoiceScreenShareContract.maximumFrameHeight
    static let voiceCameraMaximumFrameBytes = VoiceScreenShareContract.maximumFrameBytes
    static let voiceCameraJPEGQuality = VoiceScreenShareContract.jpegQuality
    static let voiceScreenShareBarHeight: CGFloat = 58
    static let voiceScreenShareBarSpacing: CGFloat = 14
    static let voiceCaptionMaximumHeight: CGFloat = 132
    static let voiceCaptionHorizontalExtension: CGFloat = 8
    static let voiceCaptionPanelRadius: CGFloat = 19
    static let voiceCaptionSpeakerSpacing: CGFloat = 6
    static let voiceCaptionLineSpacing: CGFloat = 4
    static let voiceCaptionFontSize: CGFloat = 15
    static let voiceCaptionSpeakerFontSize: CGFloat = 12
    static let voiceStatusFontSize: CGFloat = 17
    static let voiceContentSpacing: CGFloat = 14
    static let voiceMinimizeDragDistance: CGFloat = 32
    static let voiceMinimizeSpringResponse: CGFloat = 0.38
    static let voiceMinimizeSpringDamping: CGFloat = 0.9
    static let voiceStatusSpacing: CGFloat = 12
    static let voiceEndActionColor = Color.red
    static let notesHorizontalInset: CGFloat = 16
    static let notesSectionSpacing: CGFloat = 12
    static let notesControlHeight: CGFloat = 44
    static let notesRowMinimumHeight: CGFloat = 52
    static let notesIconSize: CGFloat = 18
    static let notesChipSpacing: CGFloat = 18
    static let notesGraphNodeRadius: CGFloat = 5
    static let notesGraphEdgeWidth: CGFloat = 1
    static let notesInlineSpacing: CGFloat = 4
    static let notesMetadataSpacing: CGFloat = 8
    static let notesChevronSize: CGFloat = 12
    static let notesTaskActionSize: CGFloat = 22
    static let notesEmptyIconSize: CGFloat = 28
    static let notesCompactInset: CGFloat = 2
    static let notesEditorInset: CGFloat = 4
    static let notesEditorMinimumHeight: CGFloat = 120
    static let notesConflictPreviewMaximumHeight: CGFloat = 120
    static let notesConflictPanelRadius: CGFloat = 16
    static let notesGraphSelectionStroke: CGFloat = 2
    static let notesGraphNodeLabelWidth: CGFloat = 96
    static let notesGraphMinimumZoom: CGFloat = 0.65
    static let notesGraphMaximumZoom: CGFloat = 4
    static let notesGraphEmphasizedOpacity: Double = 0.38
    static let notesGraphDimmedOpacity: Double = 0.12
    static let notesGraphNeighbourOpacity: Double = 0.72
    static let notesGraphNodeOpacity: Double = 0.46
    static let notesSearchSnippetLineLimit = 2
    static let settingsHorizontalInset = notesHorizontalInset
    static let settingsSectionSpacing = notesSectionSpacing
    static let settingsControlHeight = notesControlHeight
    static let settingsRowMinimumHeight = notesRowMinimumHeight
    static let settingsIconSize = notesIconSize
    static let settingsSearchRadius: CGFloat = 20
    static let settingsSkeletonValueWidth: CGFloat = 64
    static let settingsSkeletonValueHeight: CGFloat = 12
    static let settingsAccent = primaryAccent
    static let settingsSecondaryAccent = secondaryAccent
    static let healthHorizontalInset: CGFloat = 16
    static let healthSectionSpacing: CGFloat = 16
    static let healthRowSpacing: CGFloat = 12
    static let healthControlHeight: CGFloat = 44
    static let healthRingSize: CGFloat = 64
    static let healthRingStroke: CGFloat = 5
    static let healthChartHeight: CGFloat = 120
    static let healthMenuSpacing: CGFloat = 6
    static let healthSparklineWidth: CGFloat = 82
    static let healthSparklineHeight: CGFloat = 34
    static let healthChartLineWidth: CGFloat = 2
    static let healthTargetLineWidth: CGFloat = 1
    static let healthTargetLineDash: [CGFloat] = [4, 3]
    static let healthPanelRadius: CGFloat = 22
    static let healthAccent = primaryAccent
    static let healthAccentForeground = primaryAccentForeground
    static let healthAccentSecondary = secondaryAccent
    static let factoryHorizontalInset: CGFloat = 16
    static let factorySectionSpacing: CGFloat = 12
    static let factoryControlHeight: CGFloat = 44
    static let factoryIconSize: CGFloat = 18
    static let factoryRowSpacing: CGFloat = 8
    static let factoryPlusDiameter: CGFloat = 48
    static let factoryStateIconSize: CGFloat = 28
    static let factorySkeletonRowCount = 4
    static let factorySkeletonCornerRadius: CGFloat = 5
    static let factorySkeletonTitleHeight: CGFloat = 17
    static let factorySkeletonSecondaryWidth: CGFloat = 132
    static let factorySkeletonSecondaryHeight: CGFloat = 12
    static let factoryMultilineMinimumLines = 4
    static let factoryMultilineMaximumLines = 10
    static let factoryAccent = primaryAccent
    static let factoryAccentForeground = primaryAccentForeground
    static let factorySecondaryAccent = secondaryAccent
    static let gateContentInset: CGFloat = 32
    static let gateOrbSize: CGFloat = 250
    static let gateOrbCenterTop: CGFloat = 296
    static let gateSignInTitleTop: CGFloat = 368
    static let gateSignInTitleHeight: CGFloat = 44
    static let gateSignInHorizontalInset: CGFloat = 24
    static let gateSignInBottomInset: CGFloat = 34
    static let gateControlSpacing: CGFloat = 24
    static let gateBackgroundBlurRadius: CGFloat = 36
    static let gateBackgroundOpacity: Double = 0.66
    static let gateActionAccent = primaryAccent
    static let gateActionForeground = primaryAccent
    static let gateFaceIDSymbolSize: CGFloat = 44
    static let gateIdlePulse: CGFloat = 0.025
    static let gateSigningPulse: CGFloat = 0.09
    static let gateOrbIdleDuration: Double = 3.2
    static let gateOrbSigningDuration: Double = 0.9
    static let orbGlass = Color(red: 0.075, green: 0.11, blue: 0.16)
    static let orbGlassHighlight = Color(red: 0.26, green: 0.34, blue: 0.42)
    static let orbGlassShadow = Color(red: 0.025, green: 0.04, blue: 0.06)
    static let orbGlassShadowColor = Color.black.opacity(0.38)
    static let orbCyan = adaptiveColor(
        light: UIColor(red: 42.0 / 255, green: 164.0 / 255, blue: 194.0 / 255, alpha: 1),
        dark: UIColor(red: 82.0 / 255, green: 220.0 / 255, blue: 250.0 / 255, alpha: 1)
    )
    static let orbGlassEdge = orbCyan.opacity(0.82)
    static let orbGlassCenter = UnitPoint(x: 0.35, y: 0.27)
    static let orbGlassStartRadiusScale: CGFloat = 0.02
    static let orbGlassEndRadiusScale: CGFloat = 0.8
    static let orbGlassEdgeWidthScale: CGFloat = 0.008
    static let orbGlassShadowRadiusScale: CGFloat = 0.09
    static let orbCore = Color(red: 1, green: 0.34, blue: 0.12)
    static let orbCoreHighlight = Color(red: 1, green: 0.69, blue: 0.28)
    static let orbCoreHighlightCenter = UnitPoint(x: 0.34, y: 0.24)
    static let orbCoreCenter = UnitPoint(x: 0.5, y: 0.5)
    static let orbCoreEdgeOpacity: Double = 0.2
    static let orbCoreGlowRadiusScale: CGFloat = 0.24
    static let orbCenterSizeScale: CGFloat = 0.065
    static let orbCenterGlowOpacity: Double = 0.86
    static let orbCenterGlowRadiusScale: CGFloat = 0.09

    private static func adaptiveColor(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

struct JarvisQuietToolbarIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Color.primary.opacity(
                    configuration.isPressed
                        ? JarvisDesignTokens.toolbarQuietActionPressedOpacity
                        : JarvisDesignTokens.toolbarQuietActionFillOpacity
                ),
                in: Circle()
            )
    }
}

struct JarvisScreenBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                JarvisDesignTokens.pageBackground
                glow(
                    JarvisDesignTokens.ambientCool,
                    opacity: colorScheme == .dark ? 0.30 : 0.24,
                    size: size,
                    x: 0.12,
                    y: 0.10
                )
                glow(
                    JarvisDesignTokens.ambientWarm,
                    opacity: colorScheme == .dark ? 0.26 : 0.30,
                    size: size,
                    x: 0.94,
                    y: 0.20
                )
                glow(
                    JarvisDesignTokens.ambientGreen,
                    opacity: colorScheme == .dark ? 0.16 : 0.18,
                    size: size,
                    x: 0.24,
                    y: 0.98
                )
                glow(
                    JarvisDesignTokens.ambientBlue,
                    opacity: colorScheme == .dark ? 0.20 : 0.16,
                    size: size,
                    x: 0.92,
                    y: 0.80
                )
            }
            .frame(width: size.width, height: size.height)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private func glow(_ color: Color, opacity: Double, size: CGSize, x: CGFloat, y: CGFloat) -> some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [color.opacity(opacity), color.opacity(opacity * 0.3), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: max(size.width * 0.6, size.height * 0.36)
                )
            )
            .frame(width: size.width * 1.2, height: size.height * 0.72)
            .position(x: size.width * x, y: size.height * y)
            .accessibilityHidden(true)
    }
}
