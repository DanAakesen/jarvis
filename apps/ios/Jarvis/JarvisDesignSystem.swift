import JarvisCore
import SwiftUI
import UIKit

/// The sidebar button every page carries: the shared icon button.
struct JarvisSidebarMenuButton: View {
    @EnvironmentObject private var navigation: JarvisNavigationModel
    let language: JarvisAppLanguage

    var body: some View {
        JarvisIconButton(
            title: JarvisNotesLocalization.string(.openSidebar, language: language),
            systemImage: "sidebar.trailing",
            identifier: "navigation.openSidebar"
        ) {
            navigation.openSidebar()
        }
    }
}

enum JarvisDesignTokens {
    static var primaryAccent: Color { JarvisPalette.shared.primaryColor }
    static var primaryAccentForeground: Color { JarvisPalette.shared.onPrimaryColor }
    static var secondaryAccent: Color { JarvisPalette.shared.secondaryColor }
    static let controlInk = Color.primary.opacity(0.82)
    static let pageBackground = adaptiveColor(
        light: UIColor(red: 246.0 / 255, green: 240.0 / 255, blue: 230.0 / 255, alpha: 1),
        dark: UIColor(red: 7.0 / 255, green: 9.0 / 255, blue: 15.0 / 255, alpha: 1)
    )
    /// The page colour under the neural network: the opening screen's near-black navy in dark mode.
    static let neuralBackground = adaptiveColor(
        light: UIColor(red: 246.0 / 255, green: 240.0 / 255, blue: 230.0 / 255, alpha: 1),
        dark: UIColor(red: 2.0 / 255, green: 7.0 / 255, blue: 15.0 / 255, alpha: 1)
    )
    static var ambientCool: Color { secondaryAccent }
    static var ambientWarm: Color { primaryAccent }
    static let ambientGreen = adaptiveColor(
        light: UIColor(red: 45.0 / 255, green: 179.0 / 255, blue: 93.0 / 255, alpha: 1),
        dark: UIColor(red: 61.0 / 255, green: 220.0 / 255, blue: 132.0 / 255, alpha: 1)
    )
    static let ambientBlue = adaptiveColor(
        light: UIColor(red: 47.0 / 255, green: 128.0 / 255, blue: 237.0 / 255, alpha: 1),
        dark: UIColor(red: 59.0 / 255, green: 139.0 / 255, blue: 255.0 / 255, alpha: 1)
    )
    static let glassSolid = adaptiveColor(
        light: UIColor(red: 239.0 / 255, green: 232.0 / 255, blue: 220.0 / 255, alpha: 1),
        dark: UIColor(red: 22.0 / 255, green: 28.0 / 255, blue: 36.0 / 255, alpha: 1)
    )

    static let controlMinimumHeight: CGFloat = 44
    static let liveActivityOrbSize: CGFloat = 46
    static let liveActivityWaveformHeight: CGFloat = 28
    static let liveActivityInset: CGFloat = 12
    static let liveActivitySpacing: CGFloat = 8
    static let contentInset: CGFloat = 20
    static let contentSpacing: CGFloat = 16
    static let voicePanelEdgeInset: CGFloat = 14
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
    static var chartSeriesColors: [Color] { [primaryAccent, secondaryAccent, .green, .pink, .purple] }
    static let iconSize: CGFloat = 20
    static let sidebarWidthFraction: CGFloat = 0.74
    static let sidebarMaximumWidth: CGFloat = 320
    static let sidebarGestureStartFraction: CGFloat = 0.62
    static let sidebarGestureMinimumDistance: CGFloat = 8
    static let sidebarEdgeGestureWidth: CGFloat = 20
    static let sidebarOpenThreshold: CGFloat = 0.5
    static let sidebarCloseThreshold: CGFloat = 0.3
    static let sidebarBrandFontSize: CGFloat = 22
    /// Blur on the front page when the sidebar is fully open; it grows with the swipe.
    static let sidebarPageBlurRadius: CGFloat = 8
    static let sidebarSettingsButtonSize: CGFloat = 44
    static let sidebarHeaderLeadingInset: CGFloat = 26
    static let sidebarHeaderTrailingInset: CGFloat = 10
    static let sidebarHeaderRuleInset: CGFloat = 12
    static let sidebarHeaderRuleVerticalInset: CGFloat = 8
    static let sidebarHeaderRuleHeight: CGFloat = 0.5
    static let sidebarRowHeight: CGFloat = 52
    static let sidebarRowSpacing: CGFloat = 2
    static let sidebarRowLabelSpacing: CGFloat = 14
    static let sidebarHorizontalInset: CGFloat = 26
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
    static let chatBubbleVerticalInset: CGFloat = 4
    static let chatMessageDetailSpacing: CGFloat = 6
    static let chatMessageMaximumWidth: CGFloat = 360
    static let chatComposerPhotoSize: CGFloat = 76
    static let photoRemoveDiameter: CGFloat = 20
    static let photoRemoveGlyphSize: CGFloat = 10
    static let chatMessagePhotoSize: CGFloat = 220
    /// The one corner radius for floating surfaces: Now bar, composer, bubbles, panels, tiles and sheets of glass.
    static let surfaceRadius: CGFloat = 24
    static let chatBubbleRadius: CGFloat = surfaceRadius
    static let chatUserBubbleRadius: CGFloat = surfaceRadius
    static let chatUserBubbleBorderOpacity: Double = 0.34
    static let chatUserBubbleBorderWidth: CGFloat = 1
    static let toolbarQuietActionFillOpacity: Double = 0.08
    static let toolbarQuietActionPressedOpacity: Double = 0.16
    static let chatComposerRadius: CGFloat = surfaceRadius
    static let chatComposerSpacing: CGFloat = 10
    static let chatComposerIconSize: CGFloat = 20
    static let chatComposerSendDiameter: CGFloat = 34
    static let chatComposerTextInset: CGFloat = 14
    static let chatVideoTileWidth: CGFloat = 156
    static let chatVideoTileHeight: CGFloat = 208
    static let chatVideoTileRadius: CGFloat = surfaceRadius
    static let nowBarHeight: CGFloat = 36
    /// The small core shown in the assistant's bubble while its answer is on the way.
    static let chatMiniCoreSize: CGFloat = 28
    /// How far the composer rim's pulse travels outwards before it fades.
    static let rimRippleReach: CGFloat = 7
    static let chatMinimumTapTarget: CGFloat = 44
    /// The standard circular icon/menu diameter; photo removal keeps its smaller visible chrome.
    static let iconButtonDiameter: CGFloat = 48
    static let iconButtonGlyphSize: CGFloat = 20
    static let chatSheetCornerRadius: CGFloat = 28
    static let chatSheetRowSpacing: CGFloat = 16
    static let chatPlusMenuWidth: CGFloat = 272
    static let chatPlusMenuInset: CGFloat = 16
    static let chatPlusMenuSpacing: CGFloat = 2
    static let chatPlusMenuRowHeight: CGFloat = 44
    static let chatPlusMenuRadius: CGFloat = surfaceRadius
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
    static let voiceOrbHaloInset: CGFloat = 28
    /// Floating glass buttons share the chat header button size everywhere.
    static let voiceControlDiameter: CGFloat = chatMinimumTapTarget
    static let voiceControlSpacing: CGFloat = 16
    static let voiceControlBottomInset: CGFloat = 24
    static let voiceCameraTileWidth: CGFloat = 122
    static let voiceCameraTileHeight: CGFloat = 164
    static let voiceCameraTileCornerRadius: CGFloat = surfaceRadius
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
    static let voiceIdleCaptionReservation: CGFloat = 132
    static let voiceCaptionMaximumHeight: CGFloat = 236
    static let voiceAccessibilityCaptionMaximumHeight: CGFloat = 360
    static let voiceCaptionFadeDepth: CGFloat = 16
    static let voiceCaptionSpeakerSpacing: CGFloat = 6
    static let voiceCaptionLineSpacing: CGFloat = 4
    static let voiceStatusFontSize: CGFloat = 17
    static let voiceContentSpacing: CGFloat = 14
    static let voiceVerticalSwipeDistance: CGFloat = 32
    static let voiceMinimizeSpringResponse: CGFloat = 0.38
    static let voiceMinimizeSpringDamping: CGFloat = 0.9
    /// The orb stepping back for generated content and returning: one eased, critically damped spring, never linear.
    /// It keeps its velocity when interrupted, and Reduce Motion replaces it with no animation.
    static let voicePanelMotion: Animation = .smooth(duration: 0.55)
    static let voiceStatusSpacing: CGFloat = 12
    static let voiceEndActionColor = Color.red
    static let notesHorizontalInset: CGFloat = 16
    static let notesSectionSpacing: CGFloat = 12
    static let notesControlHeight: CGFloat = 44
    static let notesRowMinimumHeight: CGFloat = 52
    static let notesIconSize: CGFloat = 18
    static let notesChipSpacing: CGFloat = 8
    static let notesRecentTileWidth: CGFloat = 168
    static let notesFolderPersonal = adaptiveColor(
        light: UIColor(red: 45.0 / 255, green: 179.0 / 255, blue: 93.0 / 255, alpha: 1),
        dark: UIColor(red: 61.0 / 255, green: 220.0 / 255, blue: 132.0 / 255, alpha: 1)
    )
    /// The General folder's muted violet; the graph labels every cluster by name as well.
    static let notesFolderGeneral = adaptiveColor(
        light: UIColor(red: 111.0 / 255, green: 79.0 / 255, blue: 214.0 / 255, alpha: 1),
        dark: UIColor(red: 182.0 / 255, green: 156.0 / 255, blue: 1, alpha: 1)
    )
    /// Open task circles use the owner’s accent. The label also conveys the task state.
    static var notesTaskRing: Color { primaryAccent }
    /// Tighter rows in forms and sheets, which open at half height.
    static let sheetRowMinimumHeight: CGFloat = 40
    static let labelledHorizontalPadding: CGFloat = 16
    static let labelledVerticalPadding: CGFloat = 10
    static let periodSelectorHorizontalInset: CGFloat = 10
    static let notesInlineSpacing: CGFloat = 4
    static let segmentedBarSpacing: CGFloat = 12
    static let segmentedSelectionInset: CGFloat = 3
    static let segmentedSelectionOpacity: Double = 0.08
    static let selectionPressScaleX: CGFloat = 0.97
    static let selectionPressScaleY: CGFloat = 0.94
    static let selectionResponseDuration: TimeInterval = 0.28
    static let selectionBounce: Double = 0.18
    static let notesMetadataSpacing: CGFloat = 8
    static let notesChevronSize: CGFloat = 12
    static let notesTaskActionSize: CGFloat = 22
    static let notesEmptyIconSize: CGFloat = 28
    static let notesCompactInset: CGFloat = 2
    static let notesEditorInset: CGFloat = 4
    static let notesEditorMinimumHeight: CGFloat = 120
    static let notesConflictPreviewMaximumHeight: CGFloat = 120
    static let notesConflictPanelRadius: CGFloat = 16
    static let notesSearchSnippetLineLimit = 2
    static let settingsHorizontalInset = notesHorizontalInset
    static let settingsSectionSpacing = notesSectionSpacing
    static let settingsControlHeight = notesControlHeight
    static let settingsRowMinimumHeight = notesRowMinimumHeight
    static let settingsIconSize = notesIconSize
    static let settingsSearchRadius: CGFloat = 20
    static var settingsAccent: Color { primaryAccent }
    static var settingsSecondaryAccent: Color { secondaryAccent }
    static let healthHorizontalInset: CGFloat = 16
    static let healthSectionSpacing: CGFloat = 16
    static let healthRowSpacing: CGFloat = 12
    static let healthControlHeight: CGFloat = 44
    static let healthRingSize: CGFloat = 64
    static let healthRingStroke: CGFloat = 5
    static let healthChartHeight: CGFloat = 100
    static let healthLegendDotSize: CGFloat = 8
    static let healthDonutInnerRatio: CGFloat = 0.78
    static let healthHeroHeight: CGFloat = 416
    static let healthHeroRingSize: CGFloat = 96
    static let healthBarRadius: CGFloat = 4
    static let healthMenuSpacing: CGFloat = 6
    static let healthSparklineWidth: CGFloat = 82
    static let healthSparklineHeight: CGFloat = 34
    static let healthChartLineWidth: CGFloat = 2
    static let healthTargetLineWidth: CGFloat = 1
    static let healthTargetLineDash: [CGFloat] = [4, 3]
    static var healthAccent: Color { primaryAccent }
    static var healthAccentForeground: Color { primaryAccentForeground }
    static var accentSecondary: Color { secondaryAccent }
    static var healthAccentSecondary: Color { secondaryAccent }
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
    static var factoryAccent: Color { primaryAccent }
    static var factoryAccentForeground: Color { primaryAccentForeground }
    static var factorySecondaryAccent: Color { secondaryAccent }
    static let gateContentInset: CGFloat = 32
    static let gateOrbSize: CGFloat = 250
    static let gateOrbCenterTop: CGFloat = 296
    static let gateSignInTitleTop: CGFloat = 368
    static let gateSignInTitleHeight: CGFloat = 44
    static let gateSignInHorizontalInset: CGFloat = 24
    static let gateSignInBottomInset: CGFloat = 34
    static let gateControlSpacing: CGFloat = 24
    static let gateBackgroundBlurRadius: CGFloat = 36
    static let gateStateFadeDuration: Double = 0.3
    static var gateActionAccent: Color { primaryAccent }
    static var gateActionForeground: Color { primaryAccent }
    static let gateFaceIDSymbolSize: CGFloat = 44
    /// The board's light glass fill (`--g-fill-bar`): white in light, deep blue-grey in dark.
    static let dashboardCardTone = adaptiveColor(
        light: UIColor(red: 0.93, green: 0.95, blue: 0.97, alpha: 1),
        dark: UIColor(red: 0.11, green: 0.16, blue: 0.20, alpha: 1)
    )
    static let glassFill = adaptiveColor(
        light: UIColor(white: 1, alpha: 0.44),
        dark: UIColor(red: 16.0 / 255, green: 22.0 / 255, blue: 30.0 / 255, alpha: 0.36)
    )
    /// The accent glint at the end of the composer rim's sweep.
    static var rimGlint: Color { primaryAccent }

    // The cold-start opening screen is always dark, whatever the theme.
    static let openingBackground = Color(red: 2.0 / 255, green: 7.0 / 255, blue: 15.0 / 255)
    static var openingTrack: Color { JarvisPalette.shared.secondaryDarkColor.opacity(0.25) }
    static var openingAccent: Color { JarvisPalette.shared.primaryDarkColor }
    static let openingFadeDuration: Double = 0.3
    static let openingReducedFadeDuration: Double = 0.15
    static let openingBarCycle: Double = 1.5

    private static func adaptiveColor(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

/// Row button without chrome: the row dims while pressed. The only custom button style besides the glass ones.
struct JarvisPressableRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? JarvisDesignTokens.sidebarPressedOpacity : 1)
            .contentShape(Rectangle())
    }
}

/// Set by the gate while it covers the app (the opening, Face ID, the privacy cover): every neural background
/// under it holds still instead of drawing frames nobody can see.
private struct JarvisBackgroundPausedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var jarvisBackgroundPaused: Bool {
        get { self[JarvisBackgroundPausedKey.self] }
        set { self[JarvisBackgroundPausedKey.self] = newValue }
    }
}

/// Where the orb is on a screen that shows one.
enum JarvisNeuralOrbPlacement: Equatable {
    /// No orb: the lines dissolve into a faint ember.
    case hidden
    /// The orb's centre and radius in the background's own coordinates.
    case local(center: CGPoint, radius: CGFloat)
    /// The orb's frame on screen (`.global`), measured where the orb is laid out; the background converts it.
    case screen(CGRect)
}

/// The app's one background: the opening screen's sparse cyan network, with neurons that fire out from the orb and
/// return (`JarvisNeuralBackgroundView`, JarvisCore). Voice, chat and the opening ask for `.full` effects with the
/// orb's activity; every other screen gets the same network `.calm` (a few slow, faint signals) through
/// `jarvisAmbientBackground`. Never draw a second background in a screen file.
/// `orb` says where the orb is, so the network fans out from it and is cut out behind it; `intensity` dims the
/// lines and signals behind text.
struct JarvisNeuralBackground: View {
    var activity: JarvisOrbActivity = .calm
    var effects: JarvisNeuralEffects = .calm
    var orb: JarvisNeuralOrbPlacement = .hidden
    var isPaused = false
    var intensity = 1.0

    @Environment(\.jarvisBackgroundPaused) private var isCovered

    var body: some View {
        ZStack {
            JarvisDesignTokens.neuralBackground
                .overlay(JarvisSurfacePalette.shared.color("page")?.opacity(0.32) ?? .clear)
            GeometryReader { proxy in
                JarvisNeuralBackgroundView(
                    activity: activity, effects: effects, orb: resolvedOrb(in: proxy),
                    isPaused: isPaused || isCovered, intensity: intensity
                )
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func resolvedOrb(in proxy: GeometryProxy) -> JarvisNeuralOrb {
        switch orb {
        case .hidden:
            return .hidden
        case .local(let center, let radius):
            return .shown(center: center, radius: radius)
        case .screen(let frame):
            guard frame.width > 0 else { return .hidden }
            let origin = proxy.frame(in: .global).origin
            return .shown(
                center: CGPoint(x: frame.midX - origin.x, y: frame.midY - origin.y), radius: frame.width / 2
            )
        }
    }
}

/// The living background with its orb placed in it, behind every page: the same network and states as Voice, a
/// little quieter so text stays legible on top. Chat passes `.full` effects; every other page `.calm`, so the orb
/// and the signals are slower and rarer. Reduce Motion, the Background motion switch and Low Power Mode are
/// honoured here for the orb as well as the network.
struct JarvisNeuralStage: View {
    var activity: JarvisOrbActivity
    var effects: JarvisNeuralEffects = .full
    var intensity = 0.7
    /// The dark glass orb turns muddy on the light page when it is thin, so light mode keeps it denser.
    var orbOpacity: (dark: Double, light: Double) = (0.42, 0.62)

    @Environment(\.jarvisBackgroundPaused) private var isCovered
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(JarvisNeuralEffects.motionEnabledKey) private var motionEnabled = true

    var body: some View {
        GeometryReader { proxy in
            let diameter = min(proxy.size.width * 0.54, 240)
            let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height * 0.3)
            ZStack {
                JarvisNeuralBackground(
                    activity: activity, effects: effects, orb: .local(center: center, radius: diameter / 2),
                    intensity: intensity
                )
                JarvisOrb(
                    activity: activity, size: diameter, isStatic: !motionEnabled, isPaused: isCovered,
                    adaptsToLowPower: true
                )
                    .opacity(colorScheme == .dark ? orbOpacity.dark : orbOpacity.light)
                    .position(center)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The still pose of the same background, for layers nobody watches move: under a page, behind a sheet, in the
/// drawer, while a camera preview covers it.
struct JarvisScreenBackground: View {
    var body: some View {
        JarvisNeuralBackground(effects: .still)
    }
}

struct JarvisGlassSurface: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        if reduceTransparency {
            JarvisDesignTokens.glassSolid
        } else {
            Rectangle().fill(.ultraThinMaterial)
        }
    }
}

/// The background of a row in a native List or Form: the shared row surface (the glass of the glass buttons).
struct JarvisGlassRowBackground: View {
    var body: some View {
        Color.clear.jarvisGlassSurface(in: Rectangle())
    }
}

struct JarvisForm<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        Form {
            content.listRowBackground(JarvisGlassRowBackground())
        }
        .environment(\.defaultMinListRowHeight, JarvisDesignTokens.sheetRowMinimumHeight)
        .jarvisAmbientBackground()
    }
}

struct JarvisList<Head: View, Content: View>: View {
    private let customRowBackgrounds: Bool
    private let head: Head
    private let content: Content

    /// `head` is the page's headline and hero: the first row, with no glass behind it.
    init(customRowBackgrounds: Bool = false, @ViewBuilder head: () -> Head, @ViewBuilder content: () -> Content) {
        self.customRowBackgrounds = customRowBackgrounds
        self.head = head()
        self.content = content()
    }

    var body: some View {
        List {
            head
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets())
            if customRowBackgrounds {
                content
            } else {
                content.listRowBackground(JarvisGlassRowBackground())
            }
        }
        .scrollContentBackground(.hidden)
    }
}

extension JarvisList where Head == EmptyView {
    init(customRowBackgrounds: Bool = false, @ViewBuilder content: () -> Content) {
        self.init(customRowBackgrounds: customRowBackgrounds, head: { EmptyView() }, content: content)
    }
}

extension View {
    /// A page's background: the neural network with the orb behind the content, the same on every page. The page
    /// chrome owns this, so no screen draws its own orb. Sheets and forms use `jarvisAmbientBackground()`, which
    /// has no orb.
    func jarvisPageBackground(activity: JarvisOrbActivity = .calm) -> some View {
        jarvisAmbientBackground(stage: JarvisNeuralStage(activity: activity, effects: .calm))
    }

    /// The background of a sheet or form: the neural network without the orb, calm unless the screen passes a
    /// `stage` (chat's live orb).
    func jarvisAmbientBackground(
        transparentNavigationBar: Bool = true,
        stage: JarvisNeuralStage? = nil
    ) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .scrollContentBackground(.hidden)
            .background {
                if let stage {
                    stage
                } else {
                    JarvisNeuralBackground(effects: .calm)
                }
            }
            .toolbarBackground(transparentNavigationBar ? .hidden : .automatic, for: .navigationBar)
            .toolbarBackgroundVisibility(.hidden, for: .bottomBar)
            .presentationBackground { JarvisScreenBackground() }
    }
}
