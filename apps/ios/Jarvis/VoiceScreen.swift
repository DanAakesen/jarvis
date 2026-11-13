import AVFoundation
import JarvisCore
import ReplayKit
import SwiftUI

struct VoiceScreenView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var model: VoiceScreenModel
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

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                JarvisScreenBackground()

                VStack(spacing: JarvisDesignTokens.voiceContentSpacing) {
                    Spacer(minLength: 0)
                    voiceOrb(
                        diameter: min(
                            JarvisDesignTokens.gateOrbSize,
                            max(100, geometry.size.height - voiceBottomReservation -
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
                .frame(height: max(0, geometry.size.height - voiceBottomReservation))
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)

                VStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
                    Spacer(minLength: 0)
                    if model.showsConnectionRecovery {
                        connectionRecoveryActions
                    } else {
                        if model.isCaptionsEnabled, hasCaptions {
                            captions
                        }
                        if let errorMessage = model.errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(model.isPreview ? Color.secondary : Color.red)
                                .multilineTextAlignment(.center)
                                .accessibilityAddTraits(.updatesFrequently)
                        }
                    }
                }
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
                .padding(.bottom,
                         JarvisDesignTokens.voiceControlDiameter +
                         JarvisDesignTokens.voiceControlBottomInset +
                         JarvisDesignTokens.voiceContentSpacing +
                         JarvisDesignTokens.voiceScreenShareBarHeight)

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
            .contentShape(Rectangle())
            .simultaneousGesture(minimizeGesture(in: geometry.size))
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if !fixtureMode, model.voiceState.canStartSession, !model.skipsAutomaticStart {
                #if targetEnvironment(simulator)
                if ProcessInfo.processInfo.arguments.contains("--screenshot-voice-activity-fixture") { return }
                #endif
                await model.start()
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
        !model.userCaption.isEmpty || !model.assistantCaption.isEmpty || !model.sentMedia.isEmpty
    }

    private func voiceOrb(diameter: CGFloat) -> some View {
        JarvisOrb(
            activity: JarvisOrbActivity(
                voiceState: model.voiceState,
                isMuted: model.showsConnectionRecovery || model.isMuted
            ),
            size: diameter
        )
        .jarvisCarryOver(.orb)
        .frame(
            width: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2,
            height: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2
        )
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

    private var voiceBottomReservation: CGFloat {
        let captionReservation = dynamicTypeSize.isAccessibilitySize && model.isCaptionsEnabled && hasCaptions
            ? captionMaximumHeight
            : JarvisDesignTokens.voiceCaptionMaximumHeight
        return captionReservation +
            JarvisDesignTokens.voiceControlDiameter +
            JarvisDesignTokens.voiceControlBottomInset +
            JarvisDesignTokens.voiceScreenShareBarHeight +
            JarvisDesignTokens.voiceContentSpacing * 2
    }

    private var captionMaximumHeight: CGFloat {
        dynamicTypeSize.isAccessibilitySize
            ? JarvisDesignTokens.voiceAccessibilityCaptionMaximumHeight
            : JarvisDesignTokens.voiceCaptionMaximumHeight
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

    private var captions: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .center, spacing: JarvisDesignTokens.voiceCaptionLineSpacing) {
                    if !model.sentMedia.isEmpty {
                        sentMediaStrip
                    }
                    if !model.userCaption.isEmpty {
                        captionLine(
                            label: JarvisNotesLocalization.string(.voiceCaptionYou, language: appLanguage),
                            text: model.userCaption
                        )
                    }
                    if !model.assistantCaption.isEmpty {
                        captionLine(
                            label: JarvisNotesLocalization.string(.voiceCaptionJarvis, language: appLanguage),
                            text: model.assistantCaption
                        )
                    }
                    Color.clear.frame(height: 1).id("caption.latest")
                }
                .padding(.vertical, JarvisDesignTokens.voiceStatusSpacing)
                .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: model.userCaption) { _, _ in
                proxy.scrollTo("caption.latest", anchor: .bottom)
            }
            .onChange(of: model.assistantCaption) { _, _ in
                proxy.scrollTo("caption.latest", anchor: .bottom)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: captionMaximumHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(captionAccessibilityLabel)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var captionAccessibilityLabel: String {
        [
            JarvisNotesLocalization.string(.voiceCaptionsLabel, language: appLanguage),
            model.userCaption,
            model.assistantCaption,
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
                    Task { await model.start() }
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
            }

            JarvisMenuButton(
                title: JarvisVoiceLocalization.string(.add),
                systemImage: "plus",
                identifier: "voice.add",
                isDisabled: !model.canUseControls
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
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceScreenShareBarHeight / 2))
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

    private func minimizeGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: JarvisDesignTokens.voiceMinimizeDragDistance)
            .onEnded { value in
                guard value.translation.height > JarvisDesignTokens.voiceMinimizeDragDistance,
                      abs(value.translation.width) < value.translation.height,
                      model.isSessionActive, !model.showsConnectionRecovery else { return }
                let bottomControlsHeight = JarvisDesignTokens.voiceControlDiameter
                    + JarvisDesignTokens.voiceControlBottomInset
                    + (model.isScreenSharing ? JarvisDesignTokens.voiceScreenShareBarHeight + JarvisDesignTokens.voiceContentSpacing : 0)
                guard value.startLocation.y < size.height - bottomControlsHeight else { return }
                if model.isCameraEnabled && cameraFrame(in: size).contains(value.startLocation) { return }
                minimizeVoice()
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

    private func cameraFrame(in size: CGSize) -> CGRect {
        let width = JarvisDesignTokens.voiceCameraTileWidth
        let height = JarvisDesignTokens.voiceCameraTileHeight
        let center = CGPoint(
            x: min(
                max(size.width - JarvisDesignTokens.voiceCameraTileInset - width / 2 + cameraOffset.width, width / 2),
                size.width - width / 2
            ),
            y: min(
                max(size.height - JarvisDesignTokens.voiceCameraTileControlClearance - height / 2 + cameraOffset.height, height / 2),
                size.height - height / 2
            )
        )
        return CGRect(x: center.x - width / 2, y: center.y - height / 2, width: width, height: height)
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
    @ObservedObject var model: VoiceScreenModel
    let onRestore: () -> Void

    var body: some View {
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
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceScreenShareBarHeight / 2))
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
    }
}
