import AVFoundation
import JarvisCore
import ReplayKit
import SwiftUI

struct VoiceScreenView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
    @State private var showsScreenSharePicker = false
    @State private var captionsHidden = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                JarvisScreenBackground()

                VStack(spacing: JarvisDesignTokens.voiceContentSpacing) {
                    Spacer(minLength: 0)
                    VoiceOrbView(
                        status: connectionTitle ?? model.statusText,
                        state: model.voiceState,
                        canMinimize: model.isSessionActive && !model.showsConnectionRecovery,
                        isMuted: model.showsConnectionRecovery || model.isMuted,
                        diameter: min(
                            JarvisDesignTokens.gateOrbSize,
                            max(100, geometry.size.height - voiceBottomReservation -
                                JarvisDesignTokens.voiceOrbHaloInset * 2 -
                                JarvisDesignTokens.voiceStatusFontSize * 2 -
                                JarvisDesignTokens.voiceContentSpacing * 2 -
                                JarvisDesignTokens.voiceControlBottomInset)
                        )
                    ) {
                        minimizeVoice()
                    }
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
                        if model.isCaptionsEnabled, !captionsHidden, hasCaptions {
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
        .sheet(isPresented: $showsCameraViewfinder) {
            if let camera = model.camera {
                VoicePhotoViewfinder(camera: camera, language: language) {
                    model.capturePhotoForNextTurn()
                    showsCameraViewfinder = false
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $showsScreenSharePicker, onDismiss: model.refreshScreenShareState) {
            VoiceScreenSharePicker()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var hasCaptions: Bool {
        !model.userCaption.isEmpty || !model.assistantCaption.isEmpty
    }

    private var connectionTitle: String? {
        guard model.showsConnectionRecovery else { return nil }
        let key: JarvisNotesLocalizationKey =
            model.connectionPresentationState == .lost ? .voiceConnectionLost : .voiceRetrying
        return JarvisNotesLocalization.string(key, language: language)
    }

    private var connectionRecoveryActions: some View {
        HStack(spacing: JarvisDesignTokens.voiceControlSpacing) {
            Button {
                Task { await model.retryNow() }
            } label: {
                Label(
                    JarvisNotesLocalization.string(.voiceRetryNow, language: language),
                    systemImage: "arrow.clockwise"
                )
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.controlMinimumHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .tint(JarvisDesignTokens.settingsAccent)
            .disabled(model.connectionPresentationState == .retrying)

            Button {
                Task {
                    await model.end()
                    onEnd()
                }
            } label: {
                Label(
                    JarvisNotesLocalization.string(.voiceConnectionEnd, language: language),
                    systemImage: "phone.down.fill"
                )
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.controlMinimumHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .tint(JarvisDesignTokens.accentSecondary)
        }
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
    }

    private var voiceBottomReservation: CGFloat {
        JarvisDesignTokens.voiceCaptionMaximumHeight +
            JarvisDesignTokens.voiceControlDiameter +
            JarvisDesignTokens.voiceControlBottomInset +
            JarvisDesignTokens.voiceScreenShareBarHeight +
            JarvisDesignTokens.voiceContentSpacing * 2
    }

    private var captions: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.voiceCaptionLineSpacing) {
            if !model.userCaption.isEmpty {
                captionLine(
                    label: JarvisNotesLocalization.string(.voiceCaptionYou, language: appLanguage),
                    text: model.userCaption,
                    color: .secondary
                )
            }
            if !model.assistantCaption.isEmpty {
                captionLine(
                    label: JarvisNotesLocalization.string(.voiceCaptionJarvis, language: appLanguage),
                    text: model.assistantCaption,
                    color: JarvisDesignTokens.primaryAccent
                )
            }
        }
        .padding(.vertical, JarvisDesignTokens.voiceStatusSpacing)
        .padding(.leading, JarvisDesignTokens.voiceStatusSpacing)
        .padding(.trailing, JarvisDesignTokens.voiceControlDiameter - JarvisDesignTokens.voiceStatusSpacing)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: JarvisDesignTokens.voiceCaptionMaximumHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(captionAccessibilityLabel)
        .glassEffect(
            .regular,
            in: .rect(cornerRadius: JarvisDesignTokens.voiceCaptionPanelRadius)
        )
        .padding(.horizontal, -JarvisDesignTokens.voiceCaptionHorizontalExtension)
        .overlay(alignment: .topTrailing) {
            Button {
                captionsHidden = true
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(JarvisNotesLocalization.string(.voiceHideCaptions, language: appLanguage))
        }
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
        JarvisAppLanguage(
            rawValue: UserDefaults.standard.string(forKey: JarvisAppLanguage.preferenceKey) ?? ""
        ) ?? .default
    }

    private func captionLine(label: String, text: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.voiceCaptionSpeakerSpacing) {
            Text(label)
                .font(.system(size: JarvisDesignTokens.voiceCaptionSpeakerFontSize, weight: .bold))
                .tracking(0.48)
                .textCase(.uppercase)
                .foregroundStyle(color)
            Text(text)
                .font(.system(size: JarvisDesignTokens.voiceCaptionFontSize))
                .foregroundStyle(.primary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    tint: .primary,
                    action: model.openSettings
                )
            } else if model.signInRequired {
                VoiceControlButton(
                    symbol: "person.crop.circle.badge.exclamationmark",
                    label: JarvisVoiceLocalization.string(.signInRequired),
                    isSelected: false,
                    disabled: true,
                    tint: .secondary
                ) {}
            } else if !model.isSessionActive {
                VoiceControlButton(
                    symbol: "arrow.clockwise",
                    label: JarvisVoiceLocalization.string(.reconnect),
                    isSelected: false,
                    disabled: false,
                    tint: .primary
                ) {
                    Task { await model.start() }
                }
            } else {
                VoiceControlButton(
                    symbol: model.isMuted ? "mic.slash.fill" : "mic.fill",
                    label: JarvisVoiceLocalization.string(model.isMuted ? .unmute : .mute),
                    isSelected: model.isMuted,
                    disabled: !model.canUseControls,
                    tint: .primary
                ) {
                    Task { await model.toggleMute() }
                }
            }

            Menu {
                if model.isCameraEnabled {
                    Button(JarvisVoiceLocalization.string(.stopCamera), systemImage: "video.slash") {
                        Task { await model.stopCamera() }
                    }
                    Button(JarvisVoiceLocalization.string(.viewfinder), systemImage: "camera") {
                        showsCameraViewfinder = true
                    }
                } else if model.cameraPermissionDenied {
                    Button(JarvisVoiceLocalization.string(.cameraSettings), systemImage: "gearshape") {
                        model.openSettings()
                    }
                } else {
                    Button(JarvisVoiceLocalization.string(.camera), systemImage: "video") {
                        Task { await model.startCamera() }
                    }
                }
                if model.isScreenSharing {
                    Button(JarvisVoiceLocalization.string(.stopSharing), systemImage: "stop.circle") {
                        model.requestStopScreenSharing()
                    }
                } else {
                    Button(JarvisVoiceLocalization.string(.shareScreen), systemImage: "rectangle.on.rectangle") {
                        showsScreenSharePicker = true
                    }
                }
            } label: {
                Image(systemName: "plus")
                    .font(.title2.weight(.medium))
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                    .contentShape(Circle())
            }
            .buttonStyle(.glass)
            .disabled(!model.canUseControls)
            .accessibilityLabel(JarvisVoiceLocalization.string(.add))

            VoiceControlButton(
                symbol: nil,
                label: JarvisNotesLocalization.string(
                    model.isCaptionsEnabled && !captionsHidden ? .voiceHideCaptions : .voiceShowCaptions,
                    language: appLanguage
                ),
                isSelected: model.isCaptionsEnabled && !captionsHidden,
                disabled: false,
                tint: model.isCaptionsEnabled && !captionsHidden
                    ? JarvisDesignTokens.primaryAccent
                    : .primary,
                title: "CC"
            ) {
                if captionsHidden {
                    captionsHidden = false
                } else {
                    model.toggleCaptions()
                }
            }

            VoiceControlButton(
                symbol: "phone.down.fill",
                label: JarvisVoiceLocalization.string(.end),
                isSelected: false,
                disabled: !model.isSessionActive,
                tint: .white,
                prominent: true
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
            Button(JarvisVoiceLocalization.string(.stop)) { model.requestStopScreenSharing() }
                .buttonStyle(.glass)
                .accessibilityLabel(JarvisVoiceLocalization.string(.stopSharing))
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
                Button {
                    Task { await model.stopCamera() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .frame(
                            width: JarvisDesignTokens.voiceCameraCloseButtonDiameter,
                            height: JarvisDesignTokens.voiceCameraCloseButtonDiameter
                        )
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
                .padding(JarvisDesignTokens.voiceStatusSpacing / 2)
                .accessibilityLabel(JarvisVoiceLocalization.string(.stopCamera))
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

private struct VoiceOrbView: View {
    let status: String
    let state: VoiceSessionState
    let canMinimize: Bool
    let isMuted: Bool
    let diameter: CGFloat
    let onMinimize: () -> Void

    private var activity: JarvisOrbActivity {
        if isMuted { return .muted }
        switch state {
        case .listening: return .listening
        case .ready: return .thinking
        case .speaking: return .speaking
        case .reconnecting: return .reconnecting
        case .failed, .ended: return .offline
        case .idle, .connecting: return .calm
        }
    }

    var body: some View {
        JarvisOrbView(activity: activity, diameter: diameter)
            .frame(
                width: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2,
                height: diameter + JarvisDesignTokens.voiceOrbHaloInset * 2
            )
            .accessibilityElement()
            .accessibilityLabel("\(JarvisVoiceLocalization.string(.orb)). \(status)")
            .modifier(VoiceOrbMinimizeAction(isEnabled: canMinimize, action: onMinimize))
    }
}

private struct VoiceOrbMinimizeAction: ViewModifier {
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
    let tint: Color
    var title: String? = nil
    var prominent = false
    let action: () -> Void

    var body: some View {
        control
    }

    @ViewBuilder
    private var control: some View {
        if prominent {
            button
                .buttonStyle(.glassProminent)
        } else {
            button.buttonStyle(.glass)
        }
    }

    private var button: some View {
        Button(action: action) {
            Group {
                if let title {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                } else if let symbol {
                    Image(systemName: symbol)
                        .font(.title3.weight(.semibold))
                }
            }
                .foregroundStyle(tint)
                .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                .contentShape(Circle())
        }
        .disabled(disabled)
        .tint(prominent ? JarvisDesignTokens.voiceEndActionColor : tint)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct VoicePhotoViewfinder: View {
    @Environment(\.dismiss) private var dismiss
    let camera: VoiceCameraCapture
    let language: JarvisAppLanguage
    let onCapture: () -> Void

    var body: some View {
        ZStack {
            JarvisScreenBackground()
            VoiceCameraPreview(session: camera.session)
                .ignoresSafeArea()
                .accessibilityLabel(JarvisVoiceLocalization.string(.viewfinder))
            VStack {
                HStack {
                    Button(JarvisVoiceLocalization.string(.close)) { dismiss() }
                        .buttonStyle(.glass)
                    Spacer(minLength: JarvisDesignTokens.chatMessageSpacing)
                    JarvisCameraOptions(camera: camera, language: language, isDisabled: false)
                }
                Spacer()
                Button(action: onCapture) {
                    Circle()
                        .stroke(.white, lineWidth: JarvisDesignTokens.voiceOrbStrokeWidth * 2)
                        .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                        .overlay(Circle().fill(.white).padding(JarvisDesignTokens.voiceStatusSpacing / 2))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(JarvisVoiceLocalization.string(.takePhoto))
                .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
            }
            .padding(JarvisDesignTokens.voiceStatusSpacing)
        }
    }
}

private struct VoiceScreenSharePicker: View {
    var body: some View {
        VStack(spacing: JarvisDesignTokens.voiceContentSpacing) {
            Text(JarvisVoiceLocalization.string(.shareScreen))
                .font(.title2.weight(.semibold))
            VoiceSystemBroadcastPicker(accessibilityLabel: JarvisVoiceLocalization.string(.broadcastPicker))
                .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .jarvisAmbientBackground()
    }
}

struct VoiceMiniBar: View {
    @ObservedObject var model: VoiceScreenModel
    let onRestore: () -> Void

    var body: some View {
        HStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
            Button(action: onRestore) {
                HStack(spacing: JarvisDesignTokens.voiceStatusSpacing) {
                    Image(systemName: "waveform")
                    Text(model.statusText)
                        .font(.body.weight(.medium))
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(JarvisVoiceLocalization.string(.restore)). \(model.statusText)")

            Button {
                Task { await model.toggleMute() }
            } label: {
                Image(systemName: model.isMuted ? "mic.slash.fill" : "mic.fill")
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
            }
            .buttonStyle(.glass)
            .disabled(!model.canUseControls)
            .accessibilityLabel(JarvisVoiceLocalization.string(model.isMuted ? .unmute : .mute))

            Button {
                Task { await model.end() }
            } label: {
                Image(systemName: "phone.down.fill")
                    .foregroundStyle(.white)
                    .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
            }
            .buttonStyle(.glassProminent)
            .tint(JarvisDesignTokens.voiceEndActionColor)
            .accessibilityLabel(JarvisVoiceLocalization.string(.end))
        }
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceScreenShareBarHeight / 2))
        .padding(.horizontal, JarvisDesignTokens.voiceStatusSpacing)
    }
}
