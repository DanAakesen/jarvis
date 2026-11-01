import Foundation
import AVFoundation
import JarvisCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

private enum ChatComposerMode: String, CaseIterable {
    case chat = "Chat"
    case voice = "Voice"
}

enum ActivitySheetKind: String, Identifiable {
    case background
    case needsYou

    var id: String { rawValue }
    var title: String { self == .background ? "Background activity" : "Needs you" }
}

private enum ChatSheet: Identifiable {
    case activity(ActivitySheetKind)
    case camera
    case screenShare

    var id: String {
        switch self {
        case .activity(let kind): "activity-\(kind.id)"
        case .camera: "camera"
        case .screenShare: "screen-share"
        }
    }
}

private struct RenderedChatRow: Identifiable {
    let message: JarvisChatRow
    let showsTimestamp: Bool

    var id: String { message.id }
}

private enum ChatMarkdownBlock {
    case heading(level: Int, text: String)
    case paragraph(String)
    case listItem(marker: String, text: String)

    static func parse(_ markdown: String) -> [ChatMarkdownBlock] {
        var blocks: [ChatMarkdownBlock] = []
        var paragraphLines: [String] = []

        func appendParagraph() {
            guard !paragraphLines.isEmpty else { return }
            blocks.append(.paragraph(paragraphLines.joined(separator: " ")))
            paragraphLines.removeAll()
        }

        for sourceLine in markdown.components(separatedBy: .newlines) {
            let line = sourceLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else {
                appendParagraph()
                continue
            }

            let headingLevel = line.prefix(while: { $0 == "#" }).count
            if (1...6).contains(headingLevel),
               line.dropFirst(headingLevel).first?.isWhitespace == true {
                appendParagraph()
                let heading = line.dropFirst(headingLevel).trimmingCharacters(in: .whitespaces)
                blocks.append(.heading(level: headingLevel, text: heading))
                continue
            }

            if let marker = ["- ", "* ", "+ "].first(where: line.hasPrefix) {
                appendParagraph()
                blocks.append(.listItem(
                    marker: "•",
                    text: String(line.dropFirst(marker.count))
                ))
                continue
            }

            if let listItem = numberedListItem(line) {
                appendParagraph()
                blocks.append(.listItem(marker: listItem.marker, text: listItem.text))
                continue
            }

            paragraphLines.append(line)
        }

        appendParagraph()
        return blocks
    }

    private static func numberedListItem(_ line: String) -> (marker: String, text: String)? {
        guard let separator = line.firstIndex(where: { $0 == "." || $0 == ")" }),
              line[line.index(after: separator)...].first?.isWhitespace == true else {
            return nil
        }
        let number = line[..<separator]
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { return nil }
        let text = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
        return ("\(number)\(line[separator])", text)
    }
}

struct JarvisChatScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @StateObject private var model: JarvisChatModel
    @State private var presentedSheet: ChatSheet?
    @State private var composerMode: ChatComposerMode = .chat
    @State private var attachmentDialog = false
    @State private var fileImporterPresented = false
    @State private var photosPickerPresented = false
    @State private var cameraCapture: VoiceCameraCapture?
    @State private var selectedCameraPosition: AVCaptureDevice.Position = .back
    @State private var selectedCameraLens: JarvisCameraLens = .wide
    @State private var lastBackCameraLens: JarvisCameraLens = .wide
    @State private var isVideoEnabled = false
    @State private var isVideoPaused = false
    @State private var isVideoPreviewExpanded = false
    @State private var stopCameraAfterPhoto = false
    @State private var isCapturingPhoto = false
    @State private var isPreparingCamera = false
    @State private var cameraPreparationID = UUID()
    @State private var photoCaptureID = UUID()
    @State private var isScreenSharing = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @FocusState private var composerFocused: Bool
    private let initialActivitySheet: ActivitySheetKind?
    private let showsSidebarToolbarButton: Bool
    let onOpenSidebar: () -> Void
    let onNavigate: (JarvisDestination) -> Void
    private let screenShareBridge = VoiceScreenShareBridge()

    init(
        client: JarvisClient?,
        fixtureMode: Bool = false,
        initialActivitySheet: ActivitySheetKind? = nil,
        startupError: String? = nil,
        showsSidebarToolbarButton: Bool = true,
        onOpenSidebar: @escaping () -> Void = {},
        onNavigate: @escaping (JarvisDestination) -> Void
    ) {
        _model = StateObject(wrappedValue: JarvisChatModel(
            client: client,
            fixtureMode: fixtureMode,
            startupError: startupError
        ))
        self.initialActivitySheet = fixtureMode ? initialActivitySheet : nil
        self.showsSidebarToolbarButton = showsSidebarToolbarButton
        self.onOpenSidebar = onOpenSidebar
        self.onNavigate = onNavigate
    }

    private var renderedRows: [RenderedChatRow] {
        model.messages.enumerated().map { index, message in
            let previous = index > 0 ? model.messages[index - 1] : nil
            return RenderedChatRow(
                message: message,
                showsTimestamp: ChatMessageGrouping.showsTimestamp(
                    role: message.role,
                    at: message.at,
                    previousRole: previous?.role,
                    previousAt: previous?.at
                )
            )
        }
    }

    private var appLanguage: JarvisAppLanguage {
        JarvisAppLanguage(rawValue: storedLanguage) ?? .default
    }

    private var cameraSheetUITest: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-camera-sheet")
    }

    private var displayedNeedsYouCount: Int {
        let argumentPrefix = "--screenshot-needs-you-count="
        guard model.fixtureMode,
              let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(argumentPrefix) }),
              let count = Int(argument.dropFirst(argumentPrefix.count)),
              (1...99).contains(count) else {
            return model.needsYouCount
        }
        return count
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: appLanguage)
    }

    private var layout: some View {
        VStack(spacing: 0) {
            JarvisTaskActivityNotice(language: appLanguage)
            conversation
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if showsSidebarToolbarButton {
                    Button(action: onOpenSidebar) {
                        Image(systemName: "line.3.horizontal")
                            .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                    }
                    .jarvisToolbarButtonStyle()
                    .accessibilityLabel(JarvisNotesLocalization.string(.openSidebar, language: appLanguage))
                    .accessibilityIdentifier("navigation.openSidebar")
                    .modifier(NavigationBisectMenuValue())
                }
                Button {
                    presentedSheet = .activity(.needsYou)
                } label: {
                    ZStack {
                        Image(systemName: "bell")
                            .symbolVariant(displayedNeedsYouCount > 0 ? .fill : .none)
                            .font(.system(size: 18, weight: .regular))
                            .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                            .accessibilityHidden(true)
                    }
                    .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                    .overlay(alignment: .topTrailing) {
                        if displayedNeedsYouCount > 0 {
                            Text(displayedNeedsYouCount > 99 ? "99+" : "\(displayedNeedsYouCount)")
                                .font(.system(size: 10, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(JarvisDesignTokens.primaryAccentForeground)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 18, minHeight: 16)
                                .background(JarvisDesignTokens.primaryAccent, in: Capsule())
                                .offset(x: -2, y: 2)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .jarvisToolbarButtonStyle()
                .accessibilityLabel(displayedNeedsYouCount > 0
                    ? String(format: copy(.needsYouCount), displayedNeedsYouCount > 99 ? "99+" : "\(displayedNeedsYouCount)")
                    : copy(.needsYou))
                .accessibilityIdentifier("chat.notifications")
            }
        }
        .task {
            await model.load()
            await model.resumeIfSuspended()
            if let initialActivitySheet {
                presentedSheet = .activity(initialActivitySheet)
            }
            await model.watchActivity()
        }
    }

    private var attachmentPickers: some View {
        layout
        .confirmationDialog(copy(.addToMessage), isPresented: $attachmentDialog, titleVisibility: .visible) {
            Button(copy(.chooseFiles)) { fileImporterPresented = true }
            Button(copy(.photoLibrary)) { photosPickerPresented = true }
            Button(copy(.cancel), role: .cancel) {}
        }
        .fileImporter(
            isPresented: $fileImporterPresented,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true,
            onCompletion: importFiles
        )
        .photosPicker(
            isPresented: $photosPickerPresented,
            selection: $photoSelection,
            maxSelectionCount: max(1, ChatAttachmentLimits.maximumCount - model.pendingAttachments.count),
            matching: .images
        )
        .onChange(of: photoSelection) { _, selection in
            guard !selection.isEmpty else { return }
            Task { await importPhotos(selection) }
        }
        .sheet(item: $presentedSheet, onDismiss: refreshScreenSharing) { sheet in
            switch sheet {
            case .activity(let kind):
                JarvisActivitySheet(model: model, kind: kind)
                    .presentationDetents(
                        model.nowFeed?.confirmations.contains(where: { $0.actionKind == .calendarChange }) == true
                            ? [.large] : [.medium, .large]
                    )
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
            case .camera:
                if let cameraCapture {
                    JarvisChatCameraSheet(
                        camera: cameraCapture,
                        closeTitle: copy(.close),
                        takePhotoTitle: copy(.takePhoto),
                        takingPhotoTitle: copy(.takingPhoto),
                        isCapturingPhoto: isCapturingPhoto,
                        lensOptions: availableCameraLenses,
                        selectedLens: selectedCameraLens,
                        lensTitle: cameraLensTitle,
                        cameraLensTitle: copy(.cameraLens),
                        canSwitchCamera: canSwitchCamera,
                        switchCameraTitle: copy(selectedCameraPosition == .front ? .cameraSwitchToBack : .cameraSwitchToFront),
                        onCapture: captureCameraPhoto,
                        onCancel: cancelCameraPhoto,
                        onSwitchCamera: switchCameraPosition,
                        onSelectLens: selectCameraLens
                    )
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
                }
            case .screenShare:
                screenSharePicker
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else {
                refreshScreenSharing()
                Task { await model.resume() }
                return
            }
            if phase == .background { model.suspendObservation() }
            stopVideo()
        }
    }

    var body: some View {
        attachmentPickers
        .jarvisAmbientBackground()
        .toolbarBackground(.hidden, for: .navigationBar)
        .onChange(of: composerMode) { _, mode in
            guard NavigationBisectVariant.current != .K, mode == .voice else { return }
            composerMode = .chat
            onNavigate(.voice)
        }
        .onAppear(perform: refreshScreenSharing)
        .onDisappear {
            model.suspendObservation()
            stopVideo()
            if isScreenSharing { stopScreenSharing() }
        }
        .animation(
            reduceMotion ? nil : .easeOut(duration: JarvisDesignTokens.chatMessageAnimationDuration),
            value: model.messages.count
        )
    }

    @ViewBuilder
    private var conversation: some View {
        Group {
            if model.isLoading && model.messages.isEmpty {
                ProgressView("Loading")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = model.historyError, model.messages.isEmpty {
                ContentUnavailableView {
                    Label("Chat unavailable", systemImage: "wifi.slash")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await model.retryHistory() } }
                        .buttonStyle(.glass)
                        .disabled(model.fixtureMode)
                        .accessibilityHint(model.fixtureMode ? "Retry is unavailable with fixture data." : "")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                            if let error = model.historyError {
                                HStack {
                                    Text(error)
                                        .font(.footnote)
                                        .foregroundStyle(.red)
                                    Spacer()
                                    Button("Retry") { Task { await model.retryHistory() } }
                                        .buttonStyle(.glass)
                                        .disabled(model.fixtureMode)
                                        .accessibilityHint(model.fixtureMode ? "Retry is unavailable with fixture data." : "")
                                }
                            }
                            if model.hasOlderMessages {
                                Button {
                                    Task { await model.loadOlder() }
                                } label: {
                                    if model.isLoadingOlder {
                                        ProgressView()
                                    } else {
                                        Text("Load earlier messages")
                                    }
                                }
                                .buttonStyle(.glass)
                                .disabled(model.isLoadingOlder)
                                .frame(maxWidth: .infinity)
                                .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
                            }
                            ForEach(renderedRows) { row in
                                messageRow(row)
                            }
                            if !model.streamingText.isEmpty {
                                messageBubble(
                                    text: model.streamingText,
                                    role: .jarvis,
                                    interrupted: false,
                                    messageID: "streaming"
                                )
                                .id("streaming-message")
                            }
                            Color.clear
                                .frame(height: 1)
                                .id("conversation-bottom")
                        }
                        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                        .padding(.top, JarvisDesignTokens.chatHeaderContentInset)
                        .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
                    }
                    .ignoresSafeArea(edges: .top)
                    .scrollDismissesKeyboard(.interactively)
                    .defaultScrollAnchor(.bottom)
                    .onChange(of: model.messages.count) { _, _ in
                        if reduceMotion {
                            proxy.scrollTo("conversation-bottom", anchor: .bottom)
                        } else {
                            withAnimation(.easeOut(duration: JarvisDesignTokens.chatMessageAnimationDuration)) {
                                proxy.scrollTo("conversation-bottom", anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: model.streamingText) { _, _ in
                        proxy.scrollTo("conversation-bottom", anchor: .bottom)
                    }
                }
            }
        }
        .mask(alignment: .top) {
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .clear, location: 0.035),
                    .init(color: .black, location: 0.15),
                    .init(color: .black, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .overlay(alignment: .bottomTrailing) {
            if isVideoEnabled, let cameraCapture {
                videoPreview(cameraCapture)
                    .padding(.trailing, JarvisDesignTokens.chatHorizontalInset)
                    .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
            }
        }
    }

    @ViewBuilder
    private func messageRow(_ row: RenderedChatRow) -> some View {
        VStack(alignment: row.message.role == .dan ? .trailing : .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            if row.showsTimestamp {
                Text(timeString(row.message.at))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: row.message.role == .dan ? .trailing : .leading)
                    .accessibilityLabel("Message time, \(timeString(row.message.at))")
            }
            messageBubble(
                text: row.message.text,
                role: row.message.role,
                interrupted: row.message.interrupted,
                messageID: row.message.id
            )
            if !row.message.toolCalls.isEmpty {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    ForEach(row.message.toolCalls, id: \.id) { tool in
                        HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                            Image(systemName: tool.outcome == .ok ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(tool.outcome == .ok ? Color.secondary : Color.orange)
                                .accessibilityHidden(true)
                            Text(tool.tool.replacingOccurrences(of: "_", with: " "))
                            Text(tool.outcome.rawValue.capitalized)
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                        .frame(maxWidth: JarvisDesignTokens.chatMessageMaximumWidth, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if !row.message.attachments.isEmpty {
                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    ForEach(row.message.attachments, id: \.id) { attachment in
                        Label(
                            attachment.name,
                            systemImage: attachment.contentType.hasPrefix("image/") ? "photo" : "doc"
                        )
                        .font(.caption)
                        .lineLimit(1)
                        .accessibilityLabel(attachment.name)
                    }
                }
                .frame(maxWidth: .infinity, alignment: row.message.role == .dan ? .trailing : .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: row.message.role == .dan ? .trailing : .leading)
    }

    private func messageBubble(
        text: String,
        role: ConversationRole,
        interrupted: Bool,
        messageID: String
    ) -> some View {
        let isUser = role == .dan
        let userBubbleShape = RoundedRectangle(
            cornerRadius: JarvisDesignTokens.chatUserBubbleRadius,
            style: .continuous
        )
        let content = VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            messageText(text, role: role, messageID: messageID)
                .font(.body)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            if interrupted {
                Text(copy(.interrupted))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        return Group {
            if isUser {
                content
                    .padding(JarvisDesignTokens.chatGlassInset)
                    .frame(maxWidth: JarvisDesignTokens.chatMessageMaximumWidth, alignment: .leading)
                    .background {
                        if reduceTransparency {
                            userBubbleShape
                                .fill(Color(uiColor: .secondarySystemGroupedBackground))
                        }
                    }
                    .glassEffect(
                        .regular.tint(JarvisDesignTokens.primaryAccent.opacity(JarvisDesignTokens.chatGlassOpacity)),
                        in: userBubbleShape
                    )
                    .overlay {
                        userBubbleShape.strokeBorder(
                            JarvisDesignTokens.primaryAccent.opacity(
                                JarvisDesignTokens.chatUserBubbleBorderOpacity
                            ),
                            lineWidth: JarvisDesignTokens.chatUserBubbleBorderWidth
                        )
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(copy(.userSpeaker)): \(text)")
            } else {
                content
                    .padding(.vertical, JarvisDesignTokens.chatGlassInset)
                    .frame(maxWidth: JarvisDesignTokens.chatMessageMaximumWidth, alignment: .leading)
                    .accessibilityElement(children: .contain)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    @ViewBuilder
    private func messageText(_ text: String, role: ConversationRole, messageID: String) -> some View {
        if role == .jarvis {
            let blocks = ChatMarkdownBlock.parse(text)
            VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                    markdownBlock(block)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("chat-markdown-block-\(messageID)-\(index)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func markdownBlock(_ block: ChatMarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let text):
            inlineMarkdown(text)
                .font(headingFont(level))
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            inlineMarkdown(text)
        case .listItem(let marker, let text):
            HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.chatMessageSpacing) {
                Text(marker)
                    .accessibilityHidden(true)
                inlineMarkdown(text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func inlineMarkdown(_ text: String) -> Text {
        if let attributedText = try? AttributedString(markdown: text) {
            return Text(attributedText)
        }
        return Text(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.semibold)
        case 2: .title3.weight(.semibold)
        default: .headline
        }
    }

    private var composer: some View {
        VStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            if model.shouldShowNowBar {
                nowBar
            }
            if isScreenSharing {
                Label(copy(.screenSharingActive), systemImage: "dot.radiowaves.left.and.right")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            }
            if let error = model.actionError {
                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.isStaticText)
                    Spacer(minLength: 0)
                    Button(copy(.dismissError)) { model.actionError = nil }
                        .buttonStyle(.borderless)
                        .disabled(model.isSending)
                        .accessibilityLabel(copy(.dismissError))
                }
                .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                .accessibilityElement(children: .contain)
            }
            if !model.pendingAttachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                        ForEach(model.pendingAttachments) { attachment in
                            HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                                Image(systemName: attachment.contentType.hasPrefix("image/") ? "photo" : "doc")
                                    .accessibilityHidden(true)
                                Text(attachment.name)
                                    .lineLimit(1)
                                Button {
                                    model.removeAttachment(attachment)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                }
                                .buttonStyle(.borderless)
                                .disabled(model.isSending)
                                .accessibilityLabel("\(copy(.removeAttachment)): \(attachment.name)")
                            }
                            .font(.caption)
                            .padding(JarvisDesignTokens.chatMessageSpacing)
                            .glassEffect(.regular, in: .capsule)
                        }
                    }
                    .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                }
                .scrollIndicators(.hidden)
            }
            VStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                TextField(copy(.messagePlaceholder), text: $model.draft, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...JarvisDesignTokens.chatComposerMaximumLines)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit(sendMessage)
                    .disabled(model.isSending || model.fixtureTurnUnavailable)
                    .accessibilityLabel(copy(.messageLabel))
                    .accessibilityIdentifier("chat.input")
                    .accessibilityHint(model.fixtureTurnUnavailable ? copy(.fixtureTurnUnavailable) : "")
#if targetEnvironment(simulator)
                    .background {
                        if ProcessInfo.processInfo.arguments.contains("--ui-test-navigation"),
                           NavigationBisectVariant.current != .I {
                            JarvisInputHitTestingProbe()
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
#endif

                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    plusMenu

                    Picker(copy(.chatMode), selection: $composerMode) {
                        Image(systemName: "bubble.left")
                            .accessibilityLabel(JarvisNotesLocalization.string(.chatTitle, language: appLanguage))
                            .tag(ChatComposerMode.chat)
                        Image(systemName: "waveform")
                            .accessibilityLabel(JarvisNotesLocalization.string(.voiceTitle, language: appLanguage))
                            .tag(ChatComposerMode.voice)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 92, height: JarvisDesignTokens.chatMinimumTapTarget)
                    .labelsHidden()
                    .accessibilityLabel(copy(.chatMode))
                    .accessibilityIdentifier("chat.mode")

                    Spacer(minLength: 0)

                    if model.isSending {
                        Button {
                            Task { await model.cancel() }
                        } label: {
                            Group {
                                if model.isCancelling {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "stop.fill")
                                        .font(.system(size: 16, weight: .medium))
                                }
                            }
                            .frame(width: 36, height: 36)
                            .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                        .disabled(model.fixtureMode || model.isCancelling || !model.canCancel)
                        .accessibilityLabel(model.isCancelling ? copy(.cancellingTurn) : copy(.stopResponse))
                        .accessibilityHint(model.fixtureMode ? copy(.cancellationUnavailable) : "")
                    } else {
                        Button(action: sendMessage) {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 36, height: 36)
                                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .disabled(!model.canSend)
                        .accessibilityLabel(copy(.sendMessage))
                        .accessibilityIdentifier("chat.send")
                        .accessibilityHint(sendHint)
                    }
                }
            }
            .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing)
            .padding(.vertical, JarvisDesignTokens.chatMessageSpacing)
            .background {
                RoundedRectangle(cornerRadius: JarvisDesignTokens.chatComposerRadius)
                    .fill(reduceTransparency ? JarvisDesignTokens.glassSolid : Color.clear)
                    .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatComposerRadius))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
        }
    }

    private var plusMenu: some View {
        Menu {
            Menu {
                voiceLanguageOption(.da, title: copy(.danish))
                voiceLanguageOption(.en, title: copy(.english))
            } label: {
                Label(copy(.voiceLanguage), systemImage: "globe")
            }
            .disabled(model.fixtureMode || model.isSending || isPreparingCamera)

            Button {
                if isScreenSharing { stopScreenSharing() } else { openScreenSharePicker() }
            } label: {
                Label(
                    isScreenSharing ? copy(.stopSharingScreen) : copy(.shareScreen),
                    systemImage: isScreenSharing ? "stop.circle" : "rectangle.on.rectangle"
                )
            }
            .disabled(model.fixtureMode || isPreparingCamera)
            .accessibilityHint(model.fixtureMode ? copy(.screenSharingUnavailable) : "")

            Button(action: toggleVideo) {
                Label(
                    isVideoEnabled ? copy(.disableVideo) : copy(.enableVideo),
                    systemImage: isVideoEnabled ? "video.slash" : "video"
                )
            }
            .disabled(model.fixtureMode)
            .accessibilityHint(model.fixtureMode ? copy(.videoUnavailable) : "")

            Button {
                attachmentDialog = true
            } label: {
                Label(copy(.attach), systemImage: "paperclip")
            }
            .disabled(model.fixtureMode || model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount)
            .accessibilityHint(addAttachmentHint)

            Button(action: openCameraForPhoto) {
                Label(copy(.camera), systemImage: "camera")
            }
            .disabled((model.fixtureMode && !cameraSheetUITest) ||
                      model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount)
            .accessibilityHint(addAttachmentHint)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(JarvisDesignTokens.secondaryAccent)
                .frame(width: 36, height: 36)
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                .contentShape(Rectangle())
        }
        .menuOrder(.fixed)
        .disabled(model.isSending || isPreparingCamera)
        .accessibilityLabel(copy(.plusMenuLabel))
        .accessibilityIdentifier("chat.plus")
        .accessibilityHint(copy(isPreparingCamera ? .cameraStarting : .plusMenuHint))
    }

    private func voiceLanguageOption(_ language: ChatLanguage, title: String) -> some View {
        Button {
            Task { await model.setVoiceLanguage(language) }
        } label: {
            if model.voiceLanguage == language {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private var screenSharePicker: some View {
        VStack(spacing: JarvisDesignTokens.chatSheetRowSpacing) {
            Text(copy(.screenShareTitle))
                .font(.title2.weight(.semibold))
            VoiceSystemBroadcastPicker(accessibilityLabel: copy(.screenSharePickerLabel))
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.chatHorizontalInset)
        .jarvisAmbientBackground()
    }

    private func openCameraForPhoto() {
        if model.fixtureMode && cameraSheetUITest {
            stopCameraAfterPhoto = true
            cameraCapture = VoiceCameraCapture()
            presentedSheet = .camera
            return
        }
        guard !model.fixtureMode else { return }
        if isScreenSharing { stopScreenSharing() }
        stopCameraAfterPhoto = cameraCapture == nil
        if cameraCapture != nil {
            presentedSheet = .camera
            return
        }
        let requestID = UUID()
        cameraPreparationID = requestID
        isPreparingCamera = true
        Task {
            let capture = await makeCameraCapture()
            guard cameraPreparationID == requestID else {
                capture?.stop()
                return
            }
            isPreparingCamera = false
            guard let capture else { return }
            cameraCapture = capture
            presentedSheet = .camera
        }
    }

    private func toggleVideo() {
        guard !model.fixtureMode else { return }
        if isVideoEnabled {
            stopVideo()
            return
        }
        if isScreenSharing { stopScreenSharing() }
        let requestID = UUID()
        cameraPreparationID = requestID
        isPreparingCamera = true
        Task {
            let capture = await makeCameraCapture()
            guard cameraPreparationID == requestID else {
                capture?.stop()
                return
            }
            isPreparingCamera = false
            guard let capture else { return }
            cameraCapture = capture
            isVideoEnabled = true
        }
    }

    private func makeCameraCapture() async -> VoiceCameraCapture? {
        guard await VoiceCameraCapture.requestAccess() else {
            model.actionError = copy(.cameraPermissionDenied)
            return nil
        }
        let capture = VoiceCameraCapture()
        do {
            try capture.start(position: selectedCameraPosition, lens: selectedCameraLens)
            selectedCameraPosition = capture.position
            selectedCameraLens = capture.lens
            if capture.position == .back { lastBackCameraLens = capture.lens }
            model.actionError = nil
            return capture
        } catch {
            capture.stop()
            model.actionError = copy(.cameraUnavailable)
            return nil
        }
    }

    private func captureCameraPhoto() {
        guard !isCapturingPhoto else { return }
        guard let capture = cameraCapture else {
            model.actionError = copy(.cameraFrameUnavailable)
            return
        }
        guard model.pendingAttachments.count < ChatAttachmentLimits.maximumCount else {
            model.actionError = copy(.attachmentLimitReached)
            cancelCameraPhoto()
            return
        }
        let captureID = UUID()
        photoCaptureID = captureID
        isCapturingPhoto = true
        Task {
            do {
                let data = try await capture.captureStillPhoto()
                guard photoCaptureID == captureID, cameraCapture === capture else { return }
                completeCameraPhoto(data)
            } catch {
                guard photoCaptureID == captureID, cameraCapture === capture else { return }
                isCapturingPhoto = false
                model.actionError = copy(.cameraFrameUnavailable)
                cancelCameraPhoto()
            }
        }
    }

    private func completeCameraPhoto(_ data: Data) {
        photoCaptureID = UUID()
        isCapturingPhoto = false
        model.addAttachment(
            name: "Photo \(model.pendingAttachments.count + 1).jpg",
            contentType: "image/jpeg",
            data: data
        )
        presentedSheet = nil
        if stopCameraAfterPhoto {
            cameraCapture?.stop()
            cameraCapture = nil
        }
        stopCameraAfterPhoto = false
    }

    private func cancelCameraPhoto() {
        photoCaptureID = UUID()
        isCapturingPhoto = false
        presentedSheet = nil
        if stopCameraAfterPhoto {
            cameraCapture?.stop()
            cameraCapture = nil
        }
        stopCameraAfterPhoto = false
    }

    private func stopVideo() {
        cameraPreparationID = UUID()
        isPreparingCamera = false
        isVideoEnabled = false
        isVideoPaused = false
        isVideoPreviewExpanded = false
        if case .camera? = presentedSheet { presentedSheet = nil }
        stopCameraAfterPhoto = false
        isCapturingPhoto = false
        cameraCapture?.stop()
        cameraCapture = nil
    }

    private var canSwitchCamera: Bool {
        VoiceCameraCapture.availablePositions.contains { $0 != selectedCameraPosition }
    }

    private var availableCameraLenses: [JarvisCameraLens] {
        VoiceCameraCapture.availableLenses(for: selectedCameraPosition)
    }

    private func cameraLensTitle(_ lens: JarvisCameraLens) -> String {
        switch lens {
        case .ultraWide: copy(.cameraLensUltraWide)
        case .wide: copy(.cameraLensWide)
        case .telephoto: copy(.cameraLensTelephoto)
        }
    }

    private func selectCameraLens(_ lens: JarvisCameraLens) {
        do {
            try cameraCapture?.selectCamera(position: selectedCameraPosition, lens: lens)
            selectedCameraLens = lens
            if selectedCameraPosition == .back { lastBackCameraLens = lens }
        } catch {
            model.actionError = copy(.cameraUnavailable)
        }
    }

    private func switchCameraPosition() {
        let nextPosition: AVCaptureDevice.Position = selectedCameraPosition == .front ? .back : .front
        let nextLens = nextPosition == .back ? lastBackCameraLens : .wide
        do {
            try cameraCapture?.selectCamera(position: nextPosition, lens: nextLens)
            selectedCameraPosition = nextPosition
            selectedCameraLens = nextLens
        } catch {
            model.actionError = copy(.cameraUnavailable)
        }
    }

    private func toggleVideoPaused() {
        isVideoPaused.toggle()
        cameraCapture?.setVideoPaused(isVideoPaused)
    }

    private var cameraPositionButton: some View {
        Group {
            if canSwitchCamera {
                Button(action: switchCameraPosition) {
                    Image(systemName: "camera.rotate")
                        .font(.system(size: 16, weight: .medium))
                        .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.glass)
                .accessibilityLabel(copy(selectedCameraPosition == .front ? .cameraSwitchToBack : .cameraSwitchToFront))
                .accessibilityIdentifier("chat.camera.switch")
            }
        }
    }

    private var cameraLensMenu: some View {
        JarvisCameraLensMenu(
            options: availableCameraLenses,
            selected: selectedCameraLens,
            title: cameraLensTitle,
            accessibilityTitle: copy(.cameraLens),
            onSelect: selectCameraLens
        )
        .buttonStyle(.glass)
    }

    private func videoPreview(_ camera: VoiceCameraCapture) -> some View {
        let width = isVideoPreviewExpanded
            ? JarvisDesignTokens.chatVideoPreviewExpandedWidth
            : JarvisDesignTokens.voiceCameraTileWidth
        let height = isVideoPreviewExpanded
            ? JarvisDesignTokens.chatVideoPreviewExpandedHeight
            : JarvisDesignTokens.voiceCameraTileHeight
        return ZStack {
            VoiceCameraPreview(session: camera.session, isPaused: isVideoPaused)
                .accessibilityLabel(copy(.videoPreview))
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    cameraPositionButton
                    Spacer(minLength: 0)
                    cameraLensMenu
                    Button(action: stopVideo) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel(copy(.stopVideo))
                    .accessibilityIdentifier("chat.video.stop")
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Button(action: toggleVideoPaused) {
                        Image(systemName: isVideoPaused ? "play.fill" : "pause.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel(copy(isVideoPaused ? .resumeVideo : .pauseVideo))
                    .accessibilityIdentifier("chat.video.pause")

                    Button {
                        isVideoPreviewExpanded.toggle()
                    } label: {
                        Image(systemName: isVideoPreviewExpanded
                              ? "arrow.down.right.and.arrow.up.left"
                              : "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel(copy(isVideoPreviewExpanded ? .shrinkPreview : .expandPreview))
                    .accessibilityIdentifier("chat.video.expand")
                }
            }
            .padding(4)
        }
        .frame(width: width, height: height)
        .background(.black, in: RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceCameraTileCornerRadius))
        .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceCameraTileCornerRadius))
        .overlay {
            RoundedRectangle(cornerRadius: JarvisDesignTokens.voiceCameraTileCornerRadius)
                .strokeBorder(.white.opacity(0.16), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("chat.video.preview")
    }

    private func openScreenSharePicker() {
        guard !model.fixtureMode else { return }
        stopVideo()
        presentedSheet = .screenShare
    }

    private func stopScreenSharing() {
        screenShareBridge.requestStop()
        isScreenSharing = false
    }

    private func refreshScreenSharing() {
        isScreenSharing = screenShareBridge.isSharing
    }

    private func sendMessage() {
        guard !model.isSending, model.canSend else { return }
        let hasPendingVisualCapture = model.pendingAttachments.contains {
            $0.name == "Video.jpg" || $0.name == "Screen.jpg"
        }
        if (isVideoEnabled || isScreenSharing) && !hasPendingVisualCapture {
            guard model.pendingAttachments.count < ChatAttachmentLimits.maximumCount else {
                model.actionError = copy(.attachmentLimitReached)
                return
            }
            let frame = isScreenSharing ? screenShareBridge.latestFrame() : cameraCapture?.capturePhoto()
            guard let frame else {
                model.actionError = copy(isScreenSharing ? .screenFrameUnavailable : .cameraFrameUnavailable)
                return
            }
            let attachmentCount = model.pendingAttachments.count
            model.addAttachment(
                name: isScreenSharing ? "Screen.jpg" : "Video.jpg",
                contentType: "image/jpeg",
                data: frame
            )
            guard model.pendingAttachments.count == attachmentCount + 1 else { return }
        }
        model.send()
    }

    private var addAttachmentHint: String {
        if model.fixtureMode { return copy(.attachmentsUnavailable) }
        if model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount {
            return copy(.removeAttachmentHint)
        }
        return ""
    }

    private var sendHint: String {
        if model.fixtureTurnUnavailable { return copy(.fixtureTurnUnavailable) }
        if model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !model.pendingAttachments.isEmpty {
            return copy(.enterMessageForAttachments)
        }
        return ""
    }

    private var nowBar: some View {
        VStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
            Button {
                presentedSheet = .activity(.background)
                Task { await model.refreshActivity() }
            } label: {
                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    if model.isSending {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: model.nowFeed?.running.isEmpty == false ? "gearshape.2" : "sparkles")
                            .accessibilityHidden(true)
                    }
                    Text(model.nowTitle)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up")
                        .font(.caption.weight(.semibold))
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                .padding(.horizontal, JarvisDesignTokens.chatGlassInset)
                .contentShape(Rectangle())
            }
            .buttonStyle(.glass)
            .accessibilityLabel("\(copy(.backgroundActivity)), \(model.nowTitle)")

            if let confirmation = model.activeConfirmation {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(confirmation.actionKind == .calendarChange
                         ? (appLanguage == .da ? "Kalenderændring" : "Calendar change")
                         : confirmation.actionKind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(confirmation.summary)
                        .font(.subheadline)
                        .lineLimit(JarvisDesignTokens.chatConfirmationSummaryLines)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HStack {
                        Button {
                            Task { await model.resolve(confirmation, decision: .reject) }
                        } label: {
                            Text(model.resolvingConfirmationIDs.contains(confirmation.id)
                                 ? (appLanguage == .da ? "Sender…" : "Sending…")
                                 : JarvisApprovalLocalization.string(.decline, language: appLanguage))
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                                       minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                        .buttonStyle(.glass)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityIdentifier("now-confirmation-decline-\(confirmation.id)")
                        .accessibilityHint(model.fixtureMode
                            ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
                            : "")
                        Spacer()
                        Button {
                            Task { await model.resolve(confirmation, decision: .approve) }
                        } label: {
                            Text(model.resolvingConfirmationIDs.contains(confirmation.id)
                                 ? (appLanguage == .da ? "Sender…" : "Sending…")
                                 : JarvisApprovalLocalization.string(.approve, language: appLanguage))
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                                       minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityIdentifier("now-confirmation-approve-\(confirmation.id)")
                        .accessibilityHint(model.fixtureMode
                            ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
                            : "")
                    }
                }
                .padding(JarvisDesignTokens.chatGlassInset)
                .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
                .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            }
        }
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
    }

    private func timeString(_ value: String) -> String {
        var parser = ISO8601DateFormatter()
        let date = parser.date(from: value) ?? {
            parser.formatOptions.insert(.withFractionalSeconds)
            return parser.date(from: value)
        }()
        guard let date else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        do {
            let files = try result.get()
            let availableCount = max(0, ChatAttachmentLimits.maximumCount - model.pendingAttachments.count)
            guard files.count <= availableCount else {
                model.actionError = "You can attach up to five files."
                return
            }
            for url in files {
                let hasAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if hasAccess { url.stopAccessingSecurityScopedResource() }
                }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size > 0, size <= ChatAttachmentLimits.maximumFileBytes else {
                    model.actionError = "Each attachment must be 20 MB or smaller."
                    return
                }
                guard let contentType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType else {
                    model.actionError = "This file type is not supported."
                    return
                }
                model.addAttachment(
                    name: url.lastPathComponent,
                    contentType: contentType,
                    data: try Data(contentsOf: url, options: .mappedIfSafe)
                )
            }
        } catch {
            model.actionError = "Jarvis could not read this file."
        }
    }

    private func importPhotos(_ selection: [PhotosPickerItem]) async {
        defer { photoSelection = [] }
        let availableCount = max(0, ChatAttachmentLimits.maximumCount - model.pendingAttachments.count)
        guard selection.count <= availableCount else {
            model.actionError = "You can attach up to five files."
            return
        }
        for item in selection {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data),
                      let jpeg = image.jpegData(compressionQuality: JarvisDesignTokens.chatPhotoCompressionQuality) else {
                    model.actionError = "Jarvis could not read this photo."
                    return
                }
                model.addAttachment(
                    name: "Photo \(model.pendingAttachments.count + 1).jpg",
                    contentType: "image/jpeg",
                    data: jpeg
                )
            } catch {
                model.actionError = "Jarvis could not read this photo."
                return
            }
        }
    }
}

#Preview {
    NavigationStack {
        JarvisChatScreen(
            client: try? JarvisFixtureScenario.makeClient(),
            fixtureMode: true,
            onNavigate: { _ in }
        )
    }
}

private struct JarvisChatCameraSheet: View {
    let camera: VoiceCameraCapture
    let closeTitle: String
    let takePhotoTitle: String
    let takingPhotoTitle: String
    let isCapturingPhoto: Bool
    let lensOptions: [JarvisCameraLens]
    let selectedLens: JarvisCameraLens
    let lensTitle: (JarvisCameraLens) -> String
    let cameraLensTitle: String
    let canSwitchCamera: Bool
    let switchCameraTitle: String
    let onCapture: () -> Void
    let onCancel: () -> Void
    let onSwitchCamera: () -> Void
    let onSelectLens: (JarvisCameraLens) -> Void

    var body: some View {
        ZStack {
            JarvisScreenBackground()
            VoiceCameraPreview(session: camera.session)
                .ignoresSafeArea()
            VStack {
                HStack {
                    Button(closeTitle, systemImage: "xmark", action: onCancel)
                        .buttonStyle(.glass)
                    Spacer()
                    JarvisCameraLensMenu(
                        options: lensOptions,
                        selected: selectedLens,
                        title: lensTitle,
                        accessibilityTitle: cameraLensTitle,
                        onSelect: onSelectLens
                    )
                    .buttonStyle(.glass)
                    if canSwitchCamera {
                        Button(action: onSwitchCamera) {
                            Image(systemName: "camera.rotate")
                                .font(.system(size: 16, weight: .medium))
                                .frame(width: JarvisDesignTokens.chatMinimumTapTarget,
                                       height: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel(switchCameraTitle)
                        .accessibilityIdentifier("chat.camera.switch")
                    }
                }
                Spacer()
                Button(action: onCapture) {
                    if isCapturingPhoto {
                        ProgressView()
                            .tint(.white)
                            .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                    } else {
                        Circle()
                            .stroke(.white, lineWidth: JarvisDesignTokens.voiceOrbStrokeWidth * 2)
                            .frame(width: JarvisDesignTokens.voiceControlDiameter, height: JarvisDesignTokens.voiceControlDiameter)
                            .overlay(Circle().fill(.white).padding(JarvisDesignTokens.voiceStatusSpacing / 2))
                    }
                }
                .buttonStyle(.plain)
                .disabled(isCapturingPhoto)
                .accessibilityLabel(isCapturingPhoto ? takingPhotoTitle : takePhotoTitle)
                .accessibilityIdentifier("chat.camera.capture")
                .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
            }
            .padding(JarvisDesignTokens.voiceStatusSpacing)
        }
        .accessibilityIdentifier("chat.camera.sheet")
    }
}

private struct JarvisCameraLensMenu: View {
    let options: [JarvisCameraLens]
    let selected: JarvisCameraLens
    let title: (JarvisCameraLens) -> String
    var accessibilityTitle = ""
    let onSelect: (JarvisCameraLens) -> Void

    @ViewBuilder
    var body: some View {
        if options.count > 1 {
            Menu {
                ForEach(options) { lens in
                    Button {
                        onSelect(lens)
                    } label: {
                        if lens == selected {
                            Label(title(lens), systemImage: "checkmark")
                        } else {
                            Text(title(lens))
                        }
                    }
                }
            } label: {
                Label(title(selected), systemImage: "camera.aperture")
                    .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                           minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            }
            .accessibilityLabel(accessibilityTitle.isEmpty ? title(selected) : accessibilityTitle)
            .accessibilityValue(title(selected))
            .accessibilityIdentifier("chat.camera.lens")
        }
    }
}
