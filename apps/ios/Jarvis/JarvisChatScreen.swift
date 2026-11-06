import AVFoundation
import Foundation
import JarvisCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

/// One area for approvals, background work and notifications.
enum ActivitySheetKind: String, Identifiable {
    case activity

    var id: String { rawValue }
}

private enum ChatSheet: Identifiable {
    case activity(ActivitySheetKind)
    case camera
    case runtimeTest

    var id: String {
        switch self {
        case .activity(let kind): "activity-\(kind.id)"
        case .camera: "camera"
        case .runtimeTest: "runtimeTest"
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
    @StateObject private var dictation = ChatDictation()
    @State private var fileImporterPresented = false
    @State private var photosPickerPresented = false
    @State private var cameraCapture: VoiceCameraCapture?
    @State private var placeholderCamera = VoiceCameraCapture()
    @State private var isVideoEnabled = false
    @State private var stopCameraAfterPhoto = false
    @State private var isCapturingPhoto = false
    @State private var isPreparingCamera = false
    @State private var cameraPreparationID = UUID()
    @State private var photoCaptureID = UUID()
    @State private var isScreenSharing = false
    @State private var screenShare = ScreenShareSession()
    @State private var screenSharePickerToken = 0
    @State private var photoSelection: [PhotosPickerItem] = []
    @FocusState private var composerFocused: Bool
    private let initialActivitySheet: ActivitySheetKind?
    let onNavigate: (JarvisDestination) -> Void
    @Binding private var handoff: JarvisChatHandoff?
    @EnvironmentObject private var navigation: JarvisNavigationModel
    private var onBackToToday: (() -> Void)? {
        navigation.cameFromToday ? { navigation.navigate(to: .today) } : nil
    }
    private let runtimeTestClient: JarvisChatClient?
    private let screenShareBridge = VoiceScreenShareBridge()

    init(
        client: JarvisClient?,
        fixtureMode: Bool = false,
        initialActivitySheet: ActivitySheetKind? = nil,
        startupError: String? = nil,
        handoff: Binding<JarvisChatHandoff?> = .constant(nil),
        onNavigate: @escaping (JarvisDestination) -> Void
    ) {
        let chatModel = JarvisChatModel(
            client: client,
            fixtureMode: fixtureMode,
            startupError: startupError
        )
        _model = StateObject(wrappedValue: chatModel)
        runtimeTestClient = client.map { JarvisChatClient(client: $0) }
        self.initialActivitySheet = fixtureMode ? initialActivitySheet : nil
        self.onNavigate = onNavigate
        _handoff = handoff
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
        .overlay(alignment: .topTrailing) {
            videoTile
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onBackToToday {
                ToolbarItem(placement: .topBarLeading) {
                    JarvisIconButton(
                        title: JarvisTodayLocalization.string(.backToToday, language: appLanguage),
                        systemImage: "house",
                        identifier: "chat.backToToday",
                        action: onBackToToday
                    )
                }
                .sharedBackgroundVisibility(.hidden)
            }
            ToolbarItem(placement: .topBarTrailing) {
                JarvisIconButton(
                    title: displayedNeedsYouCount > 0 ? "Needs you, \(displayedNeedsYouCount)" : "Needs you",
                    systemImage: "bell",
                    identifier: "chat.notifications",
                    badge: displayedNeedsYouCount
                ) {
                    presentedSheet = .activity(.activity)
                }
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSidebarMenuButton(language: appLanguage)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .task(id: handoff?.action != nil || model.isReadyForHandoff ? handoff?.id : nil) {
            // Observe the root-owned action directly, even when navigation renders
            // Chat before its parent refreshes. Readiness replaces the old 10s poll.
            guard !Task.isCancelled, let pending = handoff,
                  pending.action != nil || model.isReadyForHandoff else { return }
            model.draft = pending.text
            if let action = pending.action {
                composerFocused = true
                performPlusAction(action)
            } else {
                guard model.canSend else { return }
                sendMessage()
            }
            if handoff?.id == pending.id { handoff = nil }
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
            case .runtimeTest:
                JarvisRuntimeTestSheet(client: runtimeTestClient, language: model.voiceLanguage, appLanguage: appLanguage)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
            case .camera:
                // Always built, so the shutter and lens buttons exist even without a capture device.
                JarvisChatCameraSheet(
                    camera: cameraCapture ?? placeholderCamera,
                    language: appLanguage,
                    copyText: copy,
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
        .jarvisAmbientBackground(transparentNavigationBar: true)
        .onAppear(perform: refreshScreenSharing)
        .onChange(of: liveSource) { _, _ in updateLiveStream() }
        .task {
            // Keep observing for the whole time the screen is shown: a share that restarts, or a heartbeat that
            // briefly lapses, must not leave the status stuck on "stopped".
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                refreshScreenSharing()
            }
        }
        .background {
            VoiceSystemBroadcastPicker(
                accessibilityLabel: copy(.screenSharePickerLabel),
                presentationToken: screenSharePickerToken
            )
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .onDisappear {
            dictation.stop()
            model.suspendObservation()
            model.stopLiveStream()
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
            JarvisLoadingView(title: "Loading")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.historyError, model.messages.isEmpty {
            ContentUnavailableView {
                Label("Chat unavailable", systemImage: "wifi.slash")
            } description: {
                Text(error)
            } actions: {
                JarvisLabelledButton(
                    title: "Retry",
                    isDisabled: model.fixtureMode,
                    hint: model.fixtureMode ? "Retry is unavailable with fixture data." : ""
                ) { Task { await model.retryHistory() } }
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
                                JarvisLabelledButton(
                                    title: "Retry",
                                    isDisabled: model.fixtureMode,
                                    hint: model.fixtureMode ? "Retry is unavailable with fixture data." : ""
                                ) { Task { await model.retryHistory() } }
                            }
                        }
                        if model.hasOlderMessages {
                            JarvisLabelledButton(
                                title: "Load earlier messages",
                                isBusy: model.isLoadingOlder
                            ) {
                                Task { await model.loadOlder() }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
                        }
                        ForEach(renderedRows) { row in
                            messageRow(row)
                        }
                        if model.isSending || !model.streamingText.isEmpty {
                            messageBubble(
                                text: model.streamingText.isEmpty
                                    ? (model.statusLine ?? "Thinking…") : model.streamingText,
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
                .defaultScrollAnchor(.bottom)
                .scrollEdgeEffectHidden(true, for: .top)
                .scrollEdgeEffectStyle(.soft, for: .bottom)
                .onChange(of: model.messages.last?.id) { _, _ in
                    scrollToBottom(proxy, animated: !reduceMotion)
                }
                .onChange(of: model.messages.count) { _, _ in
                    scrollToBottom(proxy, animated: !reduceMotion)
                }
                .onChange(of: model.streamingText) { _, _ in
                    scrollToBottom(proxy, animated: false)
                }
                .onChange(of: model.isSending) { _, _ in
                    scrollToBottom(proxy, animated: false)
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        // Scroll after the list has laid out the new row; scrolling in the same
        // update targets the previous content size and leaves the newest message hidden.
        Task { @MainActor in
            await Task.yield()
            if animated {
                withAnimation(.easeOut(duration: JarvisDesignTokens.chatMessageAnimationDuration)) {
                    proxy.scrollTo("conversation-bottom", anchor: .bottom)
                }
            } else {
                proxy.scrollTo("conversation-bottom", anchor: .bottom)
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
            HStack(alignment: .center, spacing: JarvisDesignTokens.chatMessageSpacing) {
                if messageID == "streaming" && model.streamingText.isEmpty {
                    JarvisOrb(
                        activity: .thinking,
                        size: JarvisDesignTokens.chatMiniCoreSize,
                        isStatic: model.fixtureMode || reduceMotion
                    )
                }
                messageText(text, role: role, messageID: messageID)
                    .font(.body)
                    .foregroundStyle(messageID == "streaming" && model.streamingText.isEmpty ? .secondary : .primary)
                    .jarvisShimmer(isActive: messageID == "streaming" && model.streamingText.isEmpty && !reduceMotion && !model.fixtureMode)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
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
                    .jarvisGlassSurface(
                        cornerRadius: JarvisDesignTokens.chatUserBubbleRadius,
                        tint: JarvisDesignTokens.primaryAccent.opacity(JarvisDesignTokens.chatGlassOpacity)
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
                    .accessibilityIdentifier("chat.message.user")
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
            if let confirmation = model.activeConfirmation {
                approvalBar(confirmation)
            }
            if let status = screenShareStatus {
                Label(status.text, systemImage: status.symbol)
                    .font(.footnote)
                    .foregroundStyle(status.isError ? Color.red : Color.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if let error = model.actionError {
                HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.isStaticText)
                    Spacer(minLength: 0)
                    JarvisLabelledButton(
                        title: "Dismiss",
                        isDisabled: model.isSending,
                        accessibilityTitle: "Dismiss error"
                    ) { model.actionError = nil }
                }
                .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
                .accessibilityElement(children: .contain)
            }
            if model.shouldShowNowBar {
                nowBar
            }
            JarvisComposerBar(
                placeholder: copy(.messagePlaceholder),
                text: $model.draft,
                isFocused: $composerFocused,
                inputIdentifier: "chat.input",
                inputHint: model.fixtureTurnUnavailable ? "The fixture supports one sample turn." : "",
                isInputDisabled: model.fixtureTurnUnavailable,
                rimState: rimState,
                isRimAnimated: !model.fixtureMode,
                waveformLevels: dictation.isListening ? dictation.levels : nil,
                onSubmit: sendMessage,
                header: {
                    if !model.pendingAttachments.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                                ForEach(model.pendingAttachments) { attachment in
                                    HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                                        Image(systemName: attachment.contentType.hasPrefix("image/") ? "photo" : "doc")
                                            .accessibilityHidden(true)
                                        Text(attachment.name)
                                            .lineLimit(1)
                                        JarvisIconButton(
                                            title: "Remove \(attachment.name)",
                                            systemImage: "xmark.circle.fill",
                                            identifier: "chat.attachment.remove",
                                            isDisabled: model.isSending
                                        ) { model.removeAttachment(attachment) }
                                    }
                                    .font(.caption)
                                    .padding(JarvisDesignTokens.chatMessageSpacing)
                                    .jarvisGlassSurface()
                                }
                            }
                            .padding(.horizontal, JarvisDesignTokens.chatComposerTextInset)
                            .padding(.top, JarvisDesignTokens.chatComposerSpacing / 2)
                        }
                        .scrollIndicators(.hidden)
                    }
                },
                leading: { plusMenu },
                actions: {
                    dictateButton
                    trailingButton
                }
            )
        }
    }

    private var rimState: JarvisRimState {
        if model.isSending { return .thinking }
        if dictation.isListening { return .listening }
        return model.canSend ? .typing : .idle
    }

    private var dictateButton: some View {
        JarvisComposerIconButton(
            title: copy(dictation.isListening ? .stopDictation : .dictate),
            systemImage: dictation.isListening ? "stop.circle.fill" : "mic",
            identifier: "chat.dictate",
            isDisabled: model.fixtureMode,
            action: toggleDictation
        )
    }

    private func toggleDictation() {
        if dictation.isListening {
            dictation.stop()
            return
        }
        Task {
            guard await ChatDictation.requestAccess() else {
                model.actionError = copy(.dictationUnavailable)
                return
            }
            do {
                try dictation.start(
                    locale: Locale(identifier: model.voiceLanguage == .da ? "da-DK" : "en-GB"),
                    base: model.draft
                ) { model.draft = $0 }
                model.actionError = nil
            } catch {
                model.actionError = copy(.dictationUnavailable)
            }
        }
    }

    /// One slot, one size: Voice while the field is empty, Send once there is text, Stop while Jarvis answers.
    @ViewBuilder
    private var trailingButton: some View {
        if model.isSending && !model.canSend {
            JarvisComposerIconButton(
                title: model.isCancelling ? "Cancelling turn" : "Stop response",
                systemImage: "stop.fill",
                identifier: "chat.stop",
                hint: model.fixtureMode ? "Cancellation is disabled with fixture data." : "",
                isDisabled: model.fixtureMode || model.isCancelling || !model.canCancel,
                isBusy: model.isCancelling,
                iconSize: JarvisDesignTokens.chatComposerIconSize - 4,
                action: { Task { await model.cancel() } }
            )
        } else if model.canSend {
            JarvisComposerIconButton(
                title: copy(.sendMessage),
                systemImage: "paperplane.fill",
                identifier: "chat.send",
                hint: sendHint,
                action: {
                    dictation.stop()
                    sendMessage()
                }
            )
        } else {
            JarvisComposerIconButton(
                title: copy(.voiceMode),
                systemImage: "waveform",
                identifier: "chat.mode",
                action: {
                    dictation.stop()
                    onNavigate(.voice)
                }
            )
        }
    }

    @ViewBuilder
    private var videoTile: some View {
        if isVideoEnabled, let cameraCapture {
            ZStack(alignment: .topTrailing) {
                VoiceCameraPreview(session: cameraCapture.session)
                    .accessibilityLabel(copy(.videoOn))
                JarvisIconButton(
                    title: copy(.disableVideo),
                    systemImage: "xmark",
                    identifier: "video.stop",
                    action: stopVideo
                )
                VStack {
                    Spacer()
                    JarvisCameraControls(camera: cameraCapture, language: appLanguage, usesTorch: true)
                        .padding(.bottom, 6)
                }
                .frame(maxWidth: .infinity)
            }
            .frame(
                width: JarvisDesignTokens.chatVideoTileWidth,
                height: JarvisDesignTokens.chatVideoTileHeight
            )
            .clipShape(RoundedRectangle(cornerRadius: JarvisDesignTokens.chatVideoTileRadius, style: .continuous))
            .padding(.trailing, JarvisDesignTokens.chatHorizontalInset)
            .padding(.top, JarvisDesignTokens.chatMessageSpacing)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("chat.videoTile")
        }
    }

    private var plusMenu: some View {
        let attachmentsFull = model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount
        return JarvisComposerPlusMenu(
            title: copy(.plusMenuLabel),
            hint: copy(isPreparingCamera ? .cameraStarting : .plusMenuHint),
            identifier: "chat.plus",
            isDisabled: model.isSending || isPreparingCamera,
            copy: copy,
            voiceLanguage: model.voiceLanguage,
            isScreenSharing: isScreenSharing,
            isVideoEnabled: isVideoEnabled,
            languageDisabled: model.fixtureMode || model.isSending,
            screenShareDisabled: model.fixtureMode || screenShare.state == .starting,
            videoDisabled: model.fixtureMode,
            attachDisabled: model.fixtureMode || attachmentsFull,
            cameraDisabled: (model.fixtureMode && !usesCameraStub) || attachmentsFull,
            onAction: performPlusAction
        )
    }

    private func performPlusAction(_ action: JarvisComposerPlusAction) {
        switch action {
        case .voiceLanguage(let language):
            Task { @MainActor in
                await Task.yield()
                await model.setVoiceLanguage(language)
            }
        case .testRuntime:
            deferred { presentedSheet = .runtimeTest }
        case .shareScreen:
            deferred {
                if isScreenSharing { stopScreenSharing() } else { openScreenSharePicker() }
            }
        case .video:
            deferred(toggleVideo)
        case .files:
            deferred { fileImporterPresented = true }
        case .photos:
            deferred { photosPickerPresented = true }
        case .camera:
            deferred(openCameraForPhoto)
        }
    }

    private func deferred(_ action: @escaping () -> Void) {
        Task { @MainActor in
            await Task.yield()
            action()
        }
    }

    private var screenShareStatus: (text: String, symbol: String, isError: Bool)? {
        switch screenShare.state {
        case .idle: nil
        case .starting: (copy(.screenShareStarting), "dot.radiowaves.left.and.right", false)
        case .live: (copy(.screenSharingActive), "dot.radiowaves.left.and.right", false)
        case .stopped: nil
        case .failed: (copy(.screenShareFailed), "exclamationmark.triangle", true)
        case .extensionMissing: (copy(.screenShareExtensionMissing), "exclamationmark.triangle", true)
        }
    }

    /// UI tests run in the simulator without a camera; they present the real sheet over an idle session.
    private var usesCameraStub: Bool {
#if targetEnvironment(simulator)
        model.fixtureMode && ProcessInfo.processInfo.arguments.contains("--ui-test-camera-sheet")
#else
        false
#endif
    }

    private func openCameraForPhoto() {
        guard !model.fixtureMode || usesCameraStub else { return }
        if usesCameraStub {
            stopCameraAfterPhoto = true
            cameraCapture = VoiceCameraCapture()
            presentedSheet = .camera
            return
        }
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
        guard !usesCameraStub else { return }
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
        if screenShare.requestStart(extensionInstalled: VoiceBroadcastExtension.isInstalled) {
            screenSharePickerToken += 1
        }
    }

    private func stopScreenSharing() {
        screenShareBridge.requestStop()
        screenShare.requestStop()
        isScreenSharing = false
    }

    private func refreshScreenSharing() {
        screenShare.observe(isSharing: screenShareBridge.isSharing)
        isScreenSharing = screenShare.state == .live
    }

    private func sendMessage() {
        guard model.canSend else { return }
        if !model.isSending, let source = liveSource {
            let frame = source == .screen ? screenShareBridge.latestFrame() : cameraCapture?.latestFrame()
            guard let frame else {
                model.actionError = copy(source == .screen ? .screenFrameUnavailable : .cameraFrameUnavailable)
                return
            }
            model.send(visualFrame: PendingVisualFrame(source: source, jpeg: frame))
            return
        }
        model.send()
    }

    /// The live input Jarvis is receiving, if any: a screen share or the camera video.
    private var liveSource: VoiceScreenSource? {
        if isScreenSharing { return .screen }
        if isVideoEnabled { return .camera }
        return nil
    }

    private func updateLiveStream() {
        switch liveSource {
        case .screen?:
            model.startLiveStream(source: .screen) { VoiceScreenShareBridge().latestFrame() }
        case .camera?:
            guard let camera = cameraCapture else { return }
            model.startLiveStream(source: .camera) { camera.latestFrame() }
        case nil:
            model.stopLiveStream()
        }
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
        JarvisLabelledButton(
            title: model.nowTitle,
            systemImage: model.nowFeed?.running.isEmpty == false ? "gearshape.2" : "sparkles",
            trailingSystemImage: "chevron.up",
            isFullWidth: true,
            isLeading: true,
            accessibilityTitle: "Background activity, \(model.nowTitle)"
        ) {
            presentedSheet = .activity(.activity)
            Task { await model.refreshActivity() }
        }
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
    }

    private func approvalBar(_ confirmation: PendingConfirmation) -> some View {
        HStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            approvalButton(confirmation, decision: .reject)
            approvalButton(confirmation, decision: .approve)
        }
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
    }

    private func approvalButton(
            _ confirmation: PendingConfirmation,
            decision: ConfirmationDecision
    ) -> some View {
        let isPending = model.isResolving(confirmation, decision: decision)
        let actionLabel = JarvisApprovalLocalization.string(
            decision == .approve ? .approve : .decline,
            language: appLanguage
        )
        return JarvisLabelledButton(
            title: isPending
                ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
                : actionLabel,
            identifier: "now-confirmation-\(decision == .approve ? "approve" : "decline")-\(confirmation.id)",
            isBusy: isPending,
            isDisabled: model.fixtureMode || model.isResolving(confirmation),
            isFullWidth: true,
            isEmphasised: decision == .approve,
            hint: model.fixtureMode
                ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
                : "",
            accessibilityTitle: actionLabel,
            accessibilityValue: isPending
                ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
                : ""
        ) {
            Task { await model.resolve(confirmation, decision: decision) }
        }
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
    .environmentObject(JarvisNavigationModel())
}

/// Camera state shared by the video-tile controls and the camera sheet, so flipping or changing lens updates both.
@MainActor
@Observable
private final class JarvisCameraControlsModel {
    let camera: VoiceCameraCapture
    var flash: AVCaptureDevice.FlashMode
    var torchOn = false
    var position: AVCaptureDevice.Position
    var lens: VoiceCameraLens
    var lenses: [VoiceCameraLens]

    init(camera: VoiceCameraCapture) {
        self.camera = camera
        flash = camera.flashMode
        position = camera.position
        lens = camera.lens
        lenses = VoiceCameraCapture.availableLenses(position: camera.position)
    }

    var flipTarget: AVCaptureDevice.Position { position == .front ? .back : .front }

    func toggleFlash() {
        flash = flash == .auto ? .on : (flash == .on ? .off : .auto)
        camera.flashMode = flash
    }

    func toggleTorch() {
        torchOn.toggle()
        camera.setTorch(torchOn)
    }

    func flip() {
        let target = flipTarget
        let available = VoiceCameraCapture.availableLenses(position: target)
        let preferred = available.contains(lens) ? lens : (available.contains(.wide) ? .wide : available.first)
        guard let preferred else { return }
        select(position: target, lens: preferred)
    }

    func select(lens newLens: VoiceCameraLens) {
        select(position: position, lens: newLens)
    }

    private func select(position newPosition: AVCaptureDevice.Position, lens newLens: VoiceCameraLens) {
        do {
            try camera.select(position: newPosition, lens: newLens)
            position = camera.position
            lens = camera.lens
            lenses = VoiceCameraCapture.availableLenses(position: position)
            torchOn = false
        } catch {
            position = camera.position
            lens = camera.lens
        }
    }

    func magnificationTitle(_ option: VoiceCameraLens) -> String {
        let factor = VoiceCameraCapture.magnification(of: option, position: position)
        let number = factor.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(factor)) : String(factor)
        return number + "×"
    }
}

private struct JarvisCameraControls: View {
    let language: JarvisAppLanguage
    var usesTorch = false
    @State private var model: JarvisCameraControlsModel

    init(camera: VoiceCameraCapture, language: JarvisAppLanguage, usesTorch: Bool = false) {
        self.language = language
        self.usesTorch = usesTorch
        _model = State(initialValue: JarvisCameraControlsModel(camera: camera))
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }

    private var lightSymbol: String {
        if usesTorch { return model.torchOn ? "bolt.fill" : "bolt.slash" }
        switch model.flash {
        case .on: return "bolt.fill"
        case .off: return "bolt.slash"
        default: return "bolt.badge.automatic"
        }
    }

    private var lightLabel: String {
        if usesTorch { return copy(model.torchOn ? .torchOff : .torchOn) }
        switch model.flash {
        case .on: return copy(.flashOn)
        case .off: return copy(.flashOff)
        default: return copy(.flashAuto)
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            if usesTorch ? model.camera.hasTorch : model.camera.hasFlash {
                JarvisIconButton(
                    title: lightLabel,
                    systemImage: lightSymbol,
                    identifier: "camera.flash",
                    action: usesTorch ? model.toggleTorch : model.toggleFlash
                )
            }
            if VoiceCameraCapture.hasCamera(position: model.flipTarget) {
                JarvisIconButton(
                    title: copy(.flipCamera),
                    systemImage: "camera.rotate",
                    identifier: "camera.flip",
                    action: model.flip
                )
            }
            if model.lenses.count > 1 {
                JarvisMenuButton(
                    title: copy(.cameraLens),
                    systemImage: "camera.metering.matrix",
                    identifier: "camera.lens",
                    text: model.magnificationTitle(model.lens),
                    value: copy(model.lens.localizationKey)
                ) {
                    Picker(copy(.cameraLens), selection: Binding(get: { model.lens }, set: { model.select(lens: $0) })) {
                        ForEach(model.lenses) { option in
                            Text(copy(option.localizationKey)).tag(option)
                        }
                    }
                }
            }
        }
    }
}

/// Picture-only camera. Like the stock Camera app, the lens buttons sit just above the shutter row, with flash
/// and switch camera on either side of the shutter, so every control is within thumb reach.
private struct JarvisChatCameraSheet: View {
    let camera: VoiceCameraCapture
    let language: JarvisAppLanguage
    let copyText: (JarvisChatLocalizationKey) -> String
    let closeTitle: String
    let takePhotoTitle: String
    let takingPhotoTitle: String
    let isCapturingPhoto: Bool
    let onCapture: () -> Void
    let onCancel: () -> Void
    @State private var model: JarvisCameraControlsModel

    init(
        camera: VoiceCameraCapture,
        language: JarvisAppLanguage,
        copyText: @escaping (JarvisChatLocalizationKey) -> String,
        closeTitle: String,
        takePhotoTitle: String,
        takingPhotoTitle: String,
        isCapturingPhoto: Bool,
        onCapture: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.camera = camera
        self.language = language
        self.copyText = copyText
        self.closeTitle = closeTitle
        self.takePhotoTitle = takePhotoTitle
        self.takingPhotoTitle = takingPhotoTitle
        self.isCapturingPhoto = isCapturingPhoto
        self.onCapture = onCapture
        self.onCancel = onCancel
        _model = State(initialValue: JarvisCameraControlsModel(camera: camera))
    }

    private var flashSymbol: String {
        switch model.flash {
        case .on: "bolt.fill"
        case .off: "bolt.slash"
        default: "bolt.badge.automatic"
        }
    }

    private var flashLabel: String {
        switch model.flash {
        case .on: copyText(.flashOn)
        case .off: copyText(.flashOff)
        default: copyText(.flashAuto)
        }
    }

    private var hasDevice: Bool { !camera.session.inputs.isEmpty }

    var body: some View {
        VStack {
            HStack {
                Spacer()
                JarvisIconButton(
                    title: closeTitle,
                    systemImage: "xmark",
                    identifier: "camera.close",
                    action: onCancel
                )
            }
            Spacer()
            lensButtons
            HStack {
                sideControl(visible: camera.hasFlash) {
                    JarvisIconButton(
                        title: flashLabel,
                        systemImage: flashSymbol,
                        identifier: "camera.flash",
                        action: model.toggleFlash
                    )
                }
                JarvisShutterButton(
                    title: isCapturingPhoto ? takingPhotoTitle : takePhotoTitle,
                    isBusy: isCapturingPhoto,
                    isDisabled: !hasDevice,
                    action: onCapture
                )
                .frame(maxWidth: .infinity)
                sideControl(visible: VoiceCameraCapture.hasCamera(position: model.flipTarget)) {
                    JarvisIconButton(
                        title: copyText(.flipCamera),
                        systemImage: "camera.rotate",
                        identifier: "camera.flip",
                        action: model.flip
                    )
                }
            }
            .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
        }
        .padding(JarvisDesignTokens.voiceStatusSpacing)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                JarvisScreenBackground()
                VoiceCameraPreview(session: camera.session)
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
        }
    }

    private var lensButtons: some View {
        HStack(spacing: 10) {
            ForEach(model.lenses.isEmpty ? [VoiceCameraLens.wide] : model.lenses) { option in
                JarvisIconButton(
                    title: copyText(option.localizationKey),
                    systemImage: nil,
                    identifier: "camera.lens.\(option.rawValue)",
                    text: model.magnificationTitle(option),
                    isDisabled: !hasDevice,
                    isSelected: option == model.lens
                ) { model.select(lens: option) }
                .accessibilityValue(model.magnificationTitle(option))
            }
        }
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private func sideControl<Content: View>(visible: Bool, @ViewBuilder _ content: () -> Content) -> some View {
        Group {
            if visible { content() } else { Color.clear }
        }
        .frame(maxWidth: .infinity)
    }
}
