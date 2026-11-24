import AVFoundation
import JarvisCore
import ReplayKit
import SwiftUI

struct VoiceScreenView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.jarvisWorkspaceRuntime) private var workspaceRuntime
    let model: VoiceScreenModel
    let language: JarvisAppLanguage
    var fixtureMode = false
    let onMinimize: () -> Void
    let onEnd: () -> Void

    @State private var cameraOffset: CGSize = .zero
    @State private var cameraDragOrigin: CGSize = .zero
    @State private var isDraggingCamera = false
    @State private var showsCameraViewfinder = false
    @State private var screenSharePickerToken = 0
    @State private var screenShareProblem: String?
    @State private var captionFollow = ChatFollowState()
    @State private var orbFrame: CGRect = .zero
    @State private var panelHeight: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                JarvisNeuralBackground(activity: orbActivity, effects: .full, orb: .screen(orbFrame))

                VStack(spacing: JarvisDesignTokens.voiceContentSpacing) {
                    Spacer(minLength: 0)
                    voiceOrb(
                        diameter: min(
                            JarvisDesignTokens.gateOrbSize,
                            max(minimumOrbDiameter(in: geometry.size), geometry.size.height - voiceBottomReservation(in: geometry.size) -
                                JarvisDesignTokens.voiceOrbHaloInset * 2 -
                                JarvisDesignTokens.voiceStatusFontSize * 2 -
                                JarvisDesignTokens.voiceContentSpacing * 2 -
                                JarvisDesignTokens.voiceControlBottomInset)
                        )
                    )
                    if let connectionTitle {
                        Text(connectionTitle)
                            .font(.system(size: JarvisDesignTokens.voiceStatusFontSize, weight: .semibold))
                            .foregroundStyle(.primary)
                            .contentTransition(.opacity)
                    } else {
                        Text(model.statusText)
                            .font(.system(size: JarvisDesignTokens.voiceStatusFontSize, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .contentTransition(.opacity)
                            .accessibilityHidden(true)
                    }

                    Spacer(minLength: JarvisDesignTokens.voiceControlBottomInset)
                }
                .frame(maxWidth: .infinity)
                .frame(height: max(0, geometry.size.height - voiceBottomReservation(in: geometry.size)))
                // Only the orb/status region can minimize Voice. Captions, visuals and call controls are siblings.
                .contentShape(Rectangle())
                .gesture(minimizeGesture)
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)

                VStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
                    Spacer(minLength: 0)
                    if model.showsConnectionRecovery {
                        connectionRecoveryActions
                    } else {
                        if model.isCaptionsEnabled, hasCaptions {
                            captions(maximumHeight: captionMaximumHeight(in: geometry.size, alongsidePanel: visiblePanelHeight > 0))
                        }
                        if let errorMessage = model.errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(model.isPreview ? Color.secondary : Color.red)
                                .multilineTextAlignment(.center)
                                .accessibilityAddTraits(.updatesFrequently)
                        }
                        if let workspaceRuntime {
                            VoiceContentSlot(
                                runtime: workspaceRuntime,
                                language: language,
                                maximumHeight: panelMaximumHeight(in: geometry.size),
                                height: $panelHeight
                            )
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
                .padding(.bottom,
                         JarvisDesignTokens.voiceControlDiameter +
                         JarvisDesignTokens.voiceControlBottomInset +
                         JarvisDesignTokens.voiceContentSpacing +
                         screenShareReservation(visualIsVisible: visiblePanelHeight > 0))

                VStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
                    Spacer(minLength: 0)
                    if !model.showsConnectionRecovery {
                        if model.isScreenSharing {
                            screenShareBar
                        }
                        controls
                            .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
                            .disabled(fixtureMode)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if !model.showsConnectionRecovery, let camera = model.camera, model.isCameraEnabled {
                    cameraTile(camera, in: geometry.size)
                }
            }
            // One eased, interruptible curve moves the orb back when content arrives and returns it when it goes.
            .animation(reduceMotion ? nil : JarvisDesignTokens.voicePanelMotion, value: panelHeight)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if !fixtureMode, model.voiceState.canStartSession, !model.skipsAutomaticStart {
                #if targetEnvironment(simulator)
                if ProcessInfo.processInfo.arguments.contains("--screenshot-voice-activity-fixture") { return }
                #endif
                // The panel shows what Jarvis presents during this session, never what was open before it.
                await startVoice()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if !fixtureMode, phase == .active {
                model.refreshCameraPermissionState()
                Task { await model.retryIfNeeded() }
            }
        }
        .sheet(isPresented: $showsCameraViewfinder, onDismiss: { model.endPhotoSession() }) {
            if let camera = model.camera {
                VoicePhotoViewfinder(camera: camera) {
                    model.capturePhotoForNextTurn()
                    showsCameraViewfinder = false
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
        .background {
            VoiceSystemBroadcastPicker(
                accessibilityLabel: JarvisVoiceLocalization.string(.broadcastPicker),
                presentationToken: screenSharePickerToken
            )
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .alert(
            JarvisVoiceLocalization.string(.shareScreen),
            isPresented: Binding(
                get: { screenShareProblem != nil },
                set: { if !$0 { screenShareProblem = nil } }
            )
        ) {
            Button(JarvisVoiceLocalization.string(.close), role: .cancel) {}
        } message: {
            Text(screenShareProblem ?? "")
        }
    }

    private var hasCaptions: Bool {
        model.captionEntries.contains(where: { !$0.text.isEmpty }) || !model.sentMedia.isEmpty
    }

    private func startVoice() async {
        workspaceRuntime?.beginVoiceVisuals()
        workspaceRuntime?.reportActive()
        await model.start()
    }

    private var orbActivity: JarvisOrbActivity {
        JarvisOrbActivity(voiceState: model.voiceState, isMuted: model.showsConnectionRecovery || model.isMuted)
    }

    private func voiceOrb(diameter: CGFloat) -> some View {
        JarvisOrb(activity: orbActivity, size: diameter)
        .jarvisCarryOver(.orb)
        .frame(
            width: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2,
            height: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2
        )
        // The background fans out from the orb itself, not its halo.
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
            orbFrame = $0.insetBy(dx: JarvisDesignTokens.voiceOrbHaloInset, dy: JarvisDesignTokens.voiceOrbHaloInset)
        }
        .accessibilityElement()
        .accessibilityLabel("\(JarvisVoiceLocalization.string(.orb)). \(connectionTitle ?? model.statusText)")
        .modifier(VoiceMinimizeAction(
            isEnabled: model.isSessionActive && !model.showsConnectionRecovery,
            action: minimizeVoice
        ))
    }

    private var connectionTitle: String? {
        guard model.showsConnectionRecovery else { return nil }
        let key: JarvisNotesLocalizationKey =
            model.connectionPresentationState == .lost ? .voiceConnectionLost : .voiceRetrying
        return JarvisNotesLocalization.string(key, language: language)
    }

    private var connectionRecoveryActions: some View {
        HStack(spacing: JarvisDesignTokens.voiceControlSpacing) {
            JarvisLabelledButton(
                title: JarvisNotesLocalization.string(.voiceRetryNow, language: language),
                systemImage: "arrow.clockwise",
                identifier: "voice.retryNow",
                isDisabled: model.connectionPresentationState == .retrying,
                isFullWidth: true
            ) {
                Task { await model.retryNow() }
            }

            JarvisLabelledButton(
                title: JarvisNotesLocalization.string(.voiceConnectionEnd, language: language),
                systemImage: "phone.down.fill",
                identifier: "voice.connectionEnd",
                isFullWidth: true
            ) {
                Task {
                    await model.end()
                    onEnd()
                }
            }
        }
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
    }

    /// The panel's height while it is on screen; a connection recovery replaces it with its own actions.
    private var visiblePanelHeight: CGFloat {
        model.showsConnectionRecovery ? 0 : panelHeight
    }

    private func voiceBottomReservation(in size: CGSize) -> CGFloat {
        let showsCaptions = model.isCaptionsEnabled && hasCaptions
        let panel = visiblePanelHeight
        let captionReservation = showsCaptions
            ? captionMaximumHeight(in: size, alongsidePanel: panel > 0)
            : JarvisDesignTokens.voiceIdleCaptionReservation
        // With the panel open, space for captions is reserved only while captions are on screen.
        let reservedCaptions = panel > 0 && !showsCaptions ? 0 : captionReservation
        return reservedCaptions +
            (panel > 0 ? panel + JarvisDesignTokens.voiceContentSpacing : 0) +
            JarvisDesignTokens.voiceControlDiameter +
            JarvisDesignTokens.voiceControlBottomInset +
            screenShareReservation(visualIsVisible: panel > 0) +
            JarvisDesignTokens.voiceContentSpacing * 2
    }

    private func screenShareReservation(visualIsVisible: Bool) -> CGFloat {
        model.isScreenSharing || !visualIsVisible ? JarvisDesignTokens.voiceScreenShareBarHeight : 0
    }

    /// The most room the panel may take: what is left once the controls, the captions on screen and a small
    /// orb with its status keep their place.
    private func panelMaximumHeight(in size: CGSize) -> CGFloat {
        let captions = model.isCaptionsEnabled && hasCaptions
            ? captionMaximumHeight(in: size, alongsidePanel: true) + JarvisDesignTokens.voiceContentSpacing : 0
        return min(
            max(0, spaceForPanelAndCaptions(in: size) - captions),
            size.height * (dynamicTypeSize.isAccessibilitySize ? 0.45 : 0.34)
        )
    }

    private func spaceForPanelAndCaptions(in size: CGSize) -> CGFloat {
        let controls = JarvisDesignTokens.voiceControlDiameter +
            JarvisDesignTokens.voiceControlBottomInset +
            screenShareReservation(visualIsVisible: true) +
            JarvisDesignTokens.voiceContentSpacing * 2
        let smallOrbRegion = minimumOrbDiameter(in: size) + JarvisDesignTokens.voiceOrbHaloInset * 2 +
            JarvisDesignTokens.voiceStatusFontSize * 2 +
            JarvisDesignTokens.voiceContentSpacing * 2 +
            JarvisDesignTokens.voiceControlBottomInset
        return size.height - controls - smallOrbRegion - JarvisDesignTokens.voiceContentSpacing
    }

    private func minimumOrbDiameter(in size: CGSize) -> CGFloat {
        min(100, size.height * 0.15)
    }

    private func captionMaximumHeight(in size: CGSize, alongsidePanel: Bool) -> CGFloat {
        let maximum = dynamicTypeSize.isAccessibilitySize
            ? JarvisDesignTokens.voiceAccessibilityCaptionMaximumHeight
            : JarvisDesignTokens.voiceCaptionMaximumHeight
        let preferred = min(maximum, size.height * (dynamicTypeSize.isAccessibilitySize ? 0.42 : 0.32))
        guard alongsidePanel else { return preferred }
        let minimumPanel = JarvisDesignTokens.controlMinimumHeight * 3
        let available = spaceForPanelAndCaptions(in: size) - minimumPanel - JarvisDesignTokens.voiceContentSpacing
        return min(preferred, max(JarvisDesignTokens.controlMinimumHeight * 1.5, available))
    }

    private func sentMediaLabel(_ kind: VoiceSentMedia.Kind) -> String {
        switch kind {
        case .photo: JarvisVoiceLocalization.string(.sentPhoto)
        case .video: JarvisVoiceLocalization.string(.sentVideo)
        case .screen: JarvisVoiceLocalization.string(.sentScreen)
        }
    }

    private var sentMediaStrip: some View {
        HStack(spacing: JarvisDesignTokens.voiceCaptionSpeakerSpacing) {
            ForEach(model.sentMedia) { media in
                if let image = UIImage(data: media.jpeg) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                        .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceStatusSpacing, style: .continuous))
                        .overlay(alignment: .bottomTrailing) {
                            if media.kind != .photo {
                                Image(systemName: media.kind == .video ? "video.fill" : "rectangle.on.rectangle")
                                    .font(.caption2)
                                    .foregroundStyle(.white)
                                    .padding(2)
                            }
                        }
                        .accessibilityLabel(sentMediaLabel(media.kind))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func captions(maximumHeight: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .center, spacing: JarvisDesignTokens.voiceCaptionLineSpacing) {
                    if !model.sentMedia.isEmpty {
                        sentMediaStrip
                    }
                    ForEach(model.captionEntries.filter { !$0.text.isEmpty }) { caption in
                        captionLine(
                            label: JarvisNotesLocalization.string(
                                caption.speaker == .dan ? .voiceCaptionYou : .voiceCaptionJarvis,
                                language: appLanguage
                            ),
                            text: caption.text
                        )
                    }
                    // Include the clear margin in the scroll target so the latest words stay above the fade.
                    Color.clear.frame(height: JarvisDesignTokens.voiceCaptionFadeDepth).id("caption.latest")
                }
                .padding(.top, JarvisDesignTokens.voiceCaptionFadeDepth)
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(captionFollow.shouldFollow ? .bottom : nil, for: .sizeChanges)
            .onScrollPhaseChange { _, new in
                if captionFollow.scrollPhaseChanged(.init(new)) {
                    proxy.scrollTo("caption.latest", anchor: .bottom)
                }
            }
            .onScrollGeometryChange(for: ChatFollowState.Viewport.self) { .init($0) } action: { old, new in
                var updated = captionFollow
                _ = updated.viewportChanged(from: old, to: new)
                if updated != captionFollow { captionFollow = updated }
            }
            .onChange(of: model.captionEntries) { _, _ in
                if captionFollow.shouldFollow { proxy.scrollTo("caption.latest", anchor: .bottom) }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: maximumHeight)
        .mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                    .frame(height: JarvisDesignTokens.voiceCaptionFadeDepth)
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: JarvisDesignTokens.voiceCaptionFadeDepth)
            }
        }
        .onAppear { captionFollow = ChatFollowState() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(captionAccessibilityLabel)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var captionAccessibilityLabel: String {
        [
            JarvisNotesLocalization.string(.voiceCaptionsLabel, language: appLanguage),
            model.captionEntries
                .filter { !$0.text.isEmpty }
                .map { entry in
                    let speaker = JarvisNotesLocalization.string(
                        entry.speaker == .dan ? .voiceCaptionYou : .voiceCaptionJarvis,
                        language: appLanguage
                    )
                    return "\(speaker). \(entry.text)"
                }
                .joined(separator: ". "),
        ]
            .filter { !$0.isEmpty }
            .joined(separator: ". ")
    }

    private var appLanguage: JarvisAppLanguage {
        .default
    }

    private func captionLine(label: String, text: String) -> some View {
        VStack(spacing: JarvisDesignTokens.voiceCaptionSpeakerSpacing) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.body.weight(.medium))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)
                .lineSpacing(JarvisDesignTokens.voiceCaptionLineSpacing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }

    private var controls: some View {
        HStack(spacing: JarvisDesignTokens.voiceControlSpacing) {
            if model.microphoneDenied {
                VoiceControlButton(
                    symbol: "mic.slash",
                    label: JarvisVoiceLocalization.string(.openSettings),
                    isSelected: false,
                    disabled: false,
                    action: model.openSettings
                )
            } else if model.signInRequired {
                VoiceControlButton(
                    symbol: "person.crop.circle.badge.exclamationmark",
                    label: JarvisVoiceLocalization.string(.signInRequired),
                    isSelected: false,
                    disabled: true
                ) {}
            } else if !model.isSessionActive {
                VoiceControlButton(
                    symbol: "arrow.clockwise",
                    label: JarvisVoiceLocalization.string(.reconnect),
                    isSelected: false,
                    disabled: false
                ) {
                    Task { await startVoice() }
                }
            } else {
                VoiceControlButton(
                    symbol: model.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: JarvisVoiceLocalization.string(model.isMuted ? .unmute : .mute),
                    isSelected: model.isMuted,
                    disabled: !model.canUseControls,
                    identifier: "voice.mic"
                ) {
                    Task { await model.toggleMute() }
                }

                VoiceControlButton(
                    symbol: model.isOnSpeaker ? "speaker.wave.3.fill" : "speaker.wave.1",
                    label: JarvisVoiceLocalization.string(.speaker),
                    isSelected: model.isOnSpeaker,
                    disabled: !model.isAudioReady || !model.canUseControls,
                    identifier: "voice.speaker",
                    action: model.toggleSpeaker
                )
            }

            JarvisMenuButton(
                title: JarvisVoiceLocalization.string(.add),
                systemImage: "plus",
                identifier: "voice.add",
                isDisabled: !model.canUseControls || model.visualInputUnavailable
            ) {
                if model.cameraPermissionDenied {
                    Button(JarvisVoiceLocalization.string(.cameraSettings), systemImage: "gearshape") {
                        model.openSettings()
                    }
                }
                Toggle(isOn: Binding(
                    get: { model.isCameraEnabled },
                    set: { enabled in
                        Task { enabled ? await model.startCamera() : await model.stopCamera() }
                    }
                )) {
                    Label(JarvisVoiceLocalization.string(.enableVideo), systemImage: "video")
                }
                .accessibilityIdentifier("voice.enableVideo")
                Button(JarvisVoiceLocalization.string(.camera), systemImage: "camera") {
                    Task {
                        if await model.beginPhotoSession() { showsCameraViewfinder = true }
                    }
                }
                .accessibilityIdentifier("voice.photo")
                if model.isScreenSharing {
                    Button(JarvisVoiceLocalization.string(.stopSharing), systemImage: "stop.circle") {
                        model.requestStopScreenSharing()
                    }
                } else {
                    Button(JarvisVoiceLocalization.string(.shareScreen), systemImage: "rectangle.on.rectangle") {
                        if VoiceBroadcastExtension.isInstalled {
                            screenSharePickerToken += 1
                        } else {
                            screenShareProblem = JarvisVoiceLocalization.string(.screenShareUnavailable)
                        }
                    }
                }
            }

            VoiceControlButton(
                symbol: nil,
                label: JarvisNotesLocalization.string(
                    model.isCaptionsEnabled ? .voiceHideCaptions : .voiceShowCaptions,
                    language: appLanguage
                ),
                isSelected: model.isCaptionsEnabled,
                disabled: false,
                title: "CC"
            ) {
                model.toggleCaptions()
            }

            VoiceControlButton(
                symbol: "phone.down.fill",
                label: JarvisVoiceLocalization.string(.end),
                isSelected: false,
                disabled: !model.isSessionActive,
                identifier: "voice.end",
                isEnd: true
            ) {
                Task {
                    await model.end()
                    onEnd()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    private var screenShareBar: some View {
        HStack(spacing: JarvisDesignTokens.voiceScreenShareBarSpacing) {
            Image(systemName: "record.circle")
                .accessibilityHidden(true)
            Text(JarvisVoiceLocalization.string(.sharingScreen))
                .font(.body.weight(.medium))
            Spacer(minLength: 0)
            JarvisLabelledButton(
                title: JarvisVoiceLocalization.string(.stop),
                identifier: "voice.stopSharing",
                accessibilityTitle: JarvisVoiceLocalization.string(.stopSharing)
            ) { model.requestStopScreenSharing() }
        }
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
        .frame(maxWidth: .infinity)
        .frame(height: JarvisDesignTokens.voiceScreenShareBarHeight)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.voiceScreenShareBarHeight / 2)
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
        .accessibilityElement(children: .contain)
    }

    private func cameraTile(_ camera: VoiceCameraCapture, in size: CGSize) -> some View {
        let width = JarvisDesignTokens.voiceCameraTileWidth
        let height = JarvisDesignTokens.voiceCameraTileHeight
        let origin = CGPoint(
            x: size.width - width / 2 - JarvisDesignTokens.voiceCameraTileInset,
            y: size.height - JarvisDesignTokens.voiceCameraTileControlClearance - height / 2
        )
        return VoiceCameraPreview(session: camera.session)
            .frame(width: width, height: height)
            .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceCameraTileCornerRadius))
            .overlay(alignment: .topTrailing) {
                JarvisIconButton(
                    title: JarvisVoiceLocalization.string(.stopCamera),
                    systemImage: "xmark",
                    identifier: "voice.camera.stop"
                ) { Task { await model.stopCamera() } }
                .padding(JarvisDesignTokens.voiceStatusSpacing / 2)
            }
            .overlay(alignment: .bottomTrailing) {
                if model.photoIsReady {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.white)
                        .padding(JarvisDesignTokens.voiceStatusSpacing / 2)
                        .accessibilityLabel(JarvisVoiceLocalization.string(.photoReady))
                }
            }
            .shadow(
                color: .black.opacity(JarvisDesignTokens.voiceCameraShadowOpacity),
                radius: JarvisDesignTokens.voiceStatusSpacing,
                y: JarvisDesignTokens.voiceCameraShadowYOffset
            )
            .position(
                x: min(max(origin.x + cameraOffset.width, width / 2), size.width - width / 2),
                y: min(max(origin.y + cameraOffset.height, height / 2), size.height - height / 2)
            )
            .onTapGesture { showsCameraViewfinder = true }
            .gesture(
                DragGesture(minimumDistance: JarvisDesignTokens.sidebarGestureMinimumDistance)
                    .onChanged { value in
                        if !isDraggingCamera {
                            isDraggingCamera = true
                            cameraDragOrigin = cameraOffset
                        }
                        let proposed = CGSize(
                            width: cameraDragOrigin.width + value.translation.width,
                            height: cameraDragOrigin.height + value.translation.height
                        )
                        cameraOffset = clampedCameraOffset(proposed, origin: origin, size: size)
                    }
                    .onEnded { _ in isDraggingCamera = false }
            )
            .accessibilityElement(children: .contain)
            .accessibilityLabel(JarvisVoiceLocalization.string(.viewfinder))
            .accessibilityAddTraits(.isButton)
    }

    private func clampedCameraOffset(_ offset: CGSize, origin: CGPoint, size: CGSize) -> CGSize {
        let halfWidth = JarvisDesignTokens.voiceCameraTileWidth / 2
        let halfHeight = JarvisDesignTokens.voiceCameraTileHeight / 2
        let x = min(max(origin.x + offset.width, halfWidth), size.width - halfWidth)
        let y = min(max(origin.y + offset.height, halfHeight), size.height - halfHeight)
        return CGSize(width: x - origin.x, height: y - origin.y)
    }

    private var minimizeGesture: some Gesture {
        DragGesture(minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance)
            .onEnded { value in
                let direction = VoiceVerticalSwipe(
                    translation: value.translation, minimumDistance: JarvisDesignTokens.voiceVerticalSwipeDistance
                )
                if direction == .down { minimizeVoice() }
            }
    }

    private func minimizeVoice() {
        guard model.isSessionActive, !model.showsConnectionRecovery else { return }
        if !reduceMotion {
            withAnimation(.spring(
                response: JarvisDesignTokens.voiceMinimizeSpringResponse,
                dampingFraction: JarvisDesignTokens.voiceMinimizeSpringDamping
            )) {
                model.minimize()
                onMinimize()
            }
        } else {
            model.minimize()
            onMinimize()
        }
    }
}

private struct VoiceMinimizeAction: ViewModifier {
    let isEnabled: Bool
    let action: () -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            content.accessibilityAction(named: Text(JarvisVoiceLocalization.string(.minimize)), action)
        } else {
            content
        }
    }
}

private struct VoiceControlButton: View {
    let symbol: String?
    let label: String
    let isSelected: Bool
    let disabled: Bool
    var title: String? = nil
    var identifier = ""
    var isEnd = false
    let action: () -> Void

    var body: some View {
        JarvisIconButton(
            title: label,
            systemImage: title == nil ? symbol : nil,
            identifier: identifier,
            text: title,
            isDisabled: disabled,
            isSelected: isSelected,
            tint: isEnd ? JarvisDesignTokens.voiceEndActionColor : nil,
            action: action
        )
    }
}

private struct VoicePhotoViewfinder: View {
    @Environment(\.dismiss) private var dismiss
    let camera: VoiceCameraCapture
    let onCapture: () -> Void

    var body: some View {
        ZStack {
            JarvisScreenBackground()
            VoiceCameraPreview(session: camera.session)
                .ignoresSafeArea()
            VStack {
                HStack {
                    JarvisIconButton(
                        title: JarvisVoiceLocalization.string(.close),
                        systemImage: "xmark",
                        identifier: "voice.camera.close",
                        action: { dismiss() }
                    )
                    Spacer()
                }
                Spacer()
                JarvisShutterButton(
                    title: JarvisVoiceLocalization.string(.takePhoto),
                    identifier: "voice.camera.shutter",
                    action: onCapture
                )
                .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
            }
            .padding(JarvisDesignTokens.voiceStatusSpacing)
        }
    }
}

struct VoiceMiniBar: View {
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.scenePhase) private var scenePhase
    let model: VoiceScreenModel
    var announcesStatus = false
    let onRestore: () -> Void

    @ViewBuilder
    var body: some View {
        if model.isMinimized {
            controls
                .onChange(of: model.statusText) { _, status in
                    guard announcesStatus, voiceOverEnabled, scenePhase == .active else { return }
                    AccessibilityNotification.Announcement(status).post()
                }
        }
    }

    private var controls: some View {
        HStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
            JarvisLabelledButton(
                title: model.statusText,
                systemImage: "waveform",
                identifier: "voice.mini.restore",
                isFullWidth: true,
                isLeading: true,
                accessibilityTitle: "\(JarvisVoiceLocalization.string(.restore)). \(model.statusText)",
                action: onRestore
            )

            JarvisIconButton(
                title: JarvisVoiceLocalization.string(model.isMuted ? .unmute : .mute),
                systemImage: model.isMuted ? "mic.slash.fill" : "mic.fill",
                identifier: "voice.mini.mic",
                isDisabled: !model.canUseControls,
                isSelected: model.isMuted
            ) { Task { await model.toggleMute() } }

            JarvisIconButton(
                title: JarvisVoiceLocalization.string(.end),
                systemImage: "phone.down.fill",
                identifier: "voice.mini.end",
                tint: JarvisDesignTokens.voiceEndActionColor
            ) { Task { await model.end() } }
        }
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
    }
}
