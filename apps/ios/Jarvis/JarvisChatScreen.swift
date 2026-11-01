import Foundation
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
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(JarvisAppLanguage.preferenceKey) private var storedLanguage = JarvisAppLanguage.default.rawValue
    @StateObject private var model: JarvisChatModel
    @State private var presentedSheet: ChatSheet?
    @State private var composerMode: ChatComposerMode = .chat
    @State private var attachmentDialog = false
    @State private var fileImporterPresented = false
    @State private var photosPickerPresented = false
    @State private var isPlusMenuPresented = ProcessInfo.processInfo.arguments.contains("--screenshot-chat-plus-menu")
    @State private var cameraCapture: VoiceCameraCapture?
    @State private var isVideoEnabled = false
    @State private var stopCameraAfterPhoto = false
    @State private var isCapturingPhoto = false
    @State private var isPreparingCamera = false
    @State private var cameraPreparationID = UUID()
    @State private var photoCaptureID = UUID()
    @State private var isScreenSharing = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @FocusState private var composerFocused: Bool
    private let initialActivitySheet: ActivitySheetKind?
    let onNavigate: (JarvisDestination) -> Void
    private let screenShareBridge = VoiceScreenShareBridge()

    init(
        client: JarvisClient?,
        fixtureMode: Bool = false,
        initialActivitySheet: ActivitySheetKind? = nil,
        startupError: String? = nil,
        onNavigate: @escaping (JarvisDestination) -> Void
    ) {
        _model = StateObject(wrappedValue: JarvisChatModel(
            client: client,
            fixtureMode: fixtureMode,
            startupError: startupError
        ))
        self.initialActivitySheet = fixtureMode ? initialActivitySheet : nil
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

    private var reduceMotion: Bool {
        systemReduceMotion || (model.fixtureMode &&
            ProcessInfo.processInfo.arguments.contains("--ui-test-reduce-motion"))
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
            conversation
            composer
        }
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
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
                .accessibilityLabel(displayedNeedsYouCount > 0 ? "Needs you, \(displayedNeedsYouCount)" : "Needs you")
            }
        }
        .task {
            await model.load()
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
                    .presentationDetents([.medium, .large])
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
                        onCapture: captureCameraPhoto,
                        onCancel: cancelCameraPhoto
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
                return
            }
            stopVideo()
        }
    }

    var body: some View {
        attachmentPickers
        .jarvisAmbientBackground()
        .onChange(of: composerMode) { _, mode in
            guard mode == .voice else { return }
            composerMode = .chat
            onNavigate(.voice)
        }
        .onAppear(perform: refreshScreenSharing)
        .onDisappear {
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
                    .padding(.vertical, JarvisDesignTokens.chatVerticalInset)
                }
                .scrollDismissesKeyboard(.interactively)
                .accessibilityIdentifier("chat-transcript")
                .defaultScrollAnchor(.bottom)
                .task(id: model.messages.last?.id) {
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: JarvisDesignTokens.chatMessageAnimationDuration)) {
                        proxy.scrollTo("conversation-bottom", anchor: .bottom)
                    }
                }
                .onChange(of: model.streamingText) { _, _ in
                    proxy.scrollTo("conversation-bottom", anchor: .bottom)
                }
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
                Text("Interrupted")
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
                    .accessibilityLabel("You: \(text)")
            } else {
                content
                    .padding(.vertical, JarvisDesignTokens.chatGlassInset)
                    .frame(maxWidth: JarvisDesignTokens.chatMessageMaximumWidth, alignment: .leading)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Jarvis: \(text)")
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .accessibilityIdentifier(isUser ? "chat-user-message" : "chat-jarvis-message")

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
                    Button("Dismiss") { model.actionError = nil }
                        .buttonStyle(.borderless)
                        .disabled(model.isSending)
                        .accessibilityLabel("Dismiss error")
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
                                .accessibilityLabel("Remove \(attachment.name)")
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
            if isVideoEnabled, let cameraCapture {
                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    VoiceCameraPreview(session: cameraCapture.session)
                        .frame(maxWidth: .infinity)
                        .frame(height: JarvisDesignTokens.chatLivePreviewHeight)
                        .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.chatBubbleRadius))
                        .accessibilityLabel(copy(.videoOn))
                    Button(copy(.disableVideo), systemImage: "video.slash", action: stopVideo)
                        .buttonStyle(.glass)
                }
                .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            }
            HStack(alignment: .bottom, spacing: JarvisDesignTokens.chatComposerSpacing) {
                Button {
                    isPlusMenuPresented.toggle()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .medium))
                        .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                }
                .buttonStyle(.glass)
                .disabled(model.isSending || isPreparingCamera)
                .accessibilityLabel(copy(.plusMenuLabel))
                .accessibilityValue(copy(isPlusMenuPresented ? .menuExpanded : .menuCollapsed))
                .accessibilityHint(copy(isPreparingCamera ? .cameraStarting : .plusMenuHint))
                .popover(
                    isPresented: $isPlusMenuPresented,
                    attachmentAnchor: .rect(.bounds),
                    arrowEdge: .bottom
                ) {
                    plusMenu
                        .presentationCompactAdaptation(.popover)
                        .presentationBackground(.clear)
                }

                TextField("Ask Jarvis", text: $model.draft, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...JarvisDesignTokens.chatComposerMaximumLines)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit(sendMessage)
                    .disabled(model.isSending || model.fixtureTurnUnavailable)
                    .accessibilityLabel("Message Jarvis")
                    .accessibilityIdentifier("chat-composer")
                    .accessibilityHint(model.fixtureTurnUnavailable ? "The fixture supports one sample turn." : "")

                Picker("Mode", selection: $composerMode) {
                    Image(systemName: "bubble.left")
                        .accessibilityLabel("Chat")
                        .tag(ChatComposerMode.chat)
                    Image(systemName: "waveform")
                        .accessibilityLabel("Voice")
                        .tag(ChatComposerMode.voice)
                }
                .pickerStyle(.segmented)
                .frame(width: JarvisDesignTokens.chatMessageMaximumWidth * JarvisDesignTokens.chatModeWidthFraction)
                .labelsHidden()
                .accessibilityLabel("Chat or voice")

                if model.isSending {
                    Button {
                        Task { await model.cancel() }
                    } label: {
                        if model.isCancelling {
                            ProgressView()
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        } else {
                            Image(systemName: "stop.fill")
                                .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                        }
                    }
                    .buttonStyle(.glass)
                    .disabled(model.fixtureMode || model.isCancelling || !model.canCancel)
                    .accessibilityLabel(model.isCancelling ? "Cancelling turn" : "Stop response")
                    .accessibilityHint(model.fixtureMode ? "Cancellation is disabled with fixture data." : "")
                } else {
                    Button(action: sendMessage) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .semibold))
                            .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!model.canSend)
                    .accessibilityLabel("Send message")
                    .accessibilityIdentifier("chat-send")
                    .accessibilityHint(sendHint)
                }
            }
            .padding(JarvisDesignTokens.chatComposerSpacing)
            .background {
                RoundedRectangle(cornerRadius: JarvisDesignTokens.chatComposerRadius)
                    .fill(reduceTransparency ? JarvisDesignTokens.glassSolid : Color.clear)
                    .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatComposerRadius))
            }
            .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
        }
        .background(.bar)
    }

    private var plusMenu: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatPlusMenuSpacing) {
            voiceLanguageMenu
            plusMenuButton(
                isScreenSharing ? copy(.stopSharingScreen) : copy(.shareScreen),
                symbol: isScreenSharing ? "stop.circle" : "rectangle.on.rectangle",
                disabled: model.fixtureMode || isPreparingCamera,
                hint: model.fixtureMode ? copy(.screenSharingUnavailable) : "",
                action: {
                    if isScreenSharing { stopScreenSharing() } else { openScreenSharePicker() }
                }
            )
            plusMenuButton(
                isVideoEnabled ? copy(.disableVideo) : copy(.enableVideo),
                symbol: isVideoEnabled ? "video.slash" : "video",
                disabled: model.fixtureMode,
                hint: model.fixtureMode ? copy(.videoUnavailable) : "",
                action: toggleVideo
            )
            plusMenuButton(
                copy(.attach),
                symbol: "paperclip",
                disabled: model.fixtureMode || model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount,
                hint: addAttachmentHint,
                action: { attachmentDialog = true }
            )
            plusMenuButton(
                copy(.camera),
                symbol: "camera",
                disabled: model.fixtureMode || model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount,
                hint: addAttachmentHint,
                action: openCameraForPhoto
            )
        }
        .padding(JarvisDesignTokens.chatPlusMenuInset)
        .frame(width: JarvisDesignTokens.chatPlusMenuWidth)
        .glassEffect(
            .regular,
            in: .rect(cornerRadius: JarvisDesignTokens.chatPlusMenuRadius)
        )
        .accessibilityElement(children: .contain)
    }

    private var voiceLanguageMenu: some View {
        Menu {
            voiceLanguageOption(.da, title: copy(.danish))
            voiceLanguageOption(.en, title: copy(.english))
        } label: {
            HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                Label(copy(.voiceLanguage), systemImage: "globe")
                Spacer(minLength: JarvisDesignTokens.chatMessageSpacing)
                Text(copy(model.voiceLanguage == .da ? .danish : .english))
                    .foregroundStyle(.secondary)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .font(.body)
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatPlusMenuRowHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .disabled(model.fixtureMode || model.isSending || isPreparingCamera)
        .tint(JarvisDesignTokens.secondaryAccent)
        .accessibilityLabel(copy(.voiceLanguage))
        .accessibilityValue(copy(model.voiceLanguage == .da ? .danish : .english))
        .accessibilityHint(
            isPreparingCamera ? copy(.cameraStarting) :
                (model.fixtureMode ? copy(.voiceSettingsUnavailable) :
                    (model.isSending ? copy(.chatBusyHint) : ""))
        )
    }

    private func voiceLanguageOption(_ language: ChatLanguage, title: String) -> some View {
        Button {
            isPlusMenuPresented = false
            Task { @MainActor in
                await Task.yield()
                await model.setVoiceLanguage(language)
            }
        } label: {
            if model.voiceLanguage == language {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private func plusMenuButton(
        _ title: String,
        symbol: String,
        disabled: Bool = false,
        hint: String = "",
        action: @escaping () -> Void
    ) -> some View {
        Button {
            isPlusMenuPresented = false
            Task { @MainActor in
                await Task.yield()
                action()
            }
        } label: {
            Label(title, systemImage: symbol)
                .font(.body)
                .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatPlusMenuRowHeight, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled || isPreparingCamera)
        .accessibilityHint(isPreparingCamera ? copy(.cameraStarting) : hint)
    }

    private var screenSharePicker: some View {
        VStack(spacing: JarvisDesignTokens.chatSheetRowSpacing) {
            Text(copy(.screenShareTitle))
                .font(.title2.weight(.semibold))
            Text(copy(.screenShareInstructions))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            VoiceSystemBroadcastPicker(accessibilityLabel: copy(.screenSharePickerLabel))
                .frame(width: JarvisDesignTokens.chatMinimumTapTarget, height: JarvisDesignTokens.chatMinimumTapTarget)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(JarvisDesignTokens.chatHorizontalInset)
        .jarvisAmbientBackground()
    }

    private func openCameraForPhoto() {
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
            try capture.start()
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
        if case .camera? = presentedSheet { presentedSheet = nil }
        stopCameraAfterPhoto = false
        isCapturingPhoto = false
        cameraCapture?.stop()
        cameraCapture = nil
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
        if model.fixtureTurnUnavailable { return "The fixture supports one sample turn." }
        if model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !model.pendingAttachments.isEmpty {
            return "Enter a message to send these attachments."
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
            .accessibilityLabel("Background activity, \(model.nowTitle)")

            if let confirmation = model.activeConfirmation {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(confirmation.actionKind.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(confirmation.summary)
                        .font(.subheadline)
                        .lineLimit(JarvisDesignTokens.chatConfirmationSummaryLines)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HStack {
                        Button("Decline") {
                            Task { await model.resolve(confirmation, decision: .reject) }
                        }
                        .buttonStyle(.glass)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityHint(model.fixtureMode ? "Approval actions are disabled with fixture data." : "")
                        Spacer()
                        Button("Approve") {
                            Task { await model.resolve(confirmation, decision: .approve) }
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(model.fixtureMode || model.resolvingConfirmationIDs.contains(confirmation.id))
                        .accessibilityHint(model.fixtureMode ? "Approval actions are disabled with fixture data." : "")
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
    let onCapture: () -> Void
    let onCancel: () -> Void

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
                .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
            }
            .padding(JarvisDesignTokens.voiceStatusSpacing)
        }
    }
}
