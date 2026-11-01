import AVFoundation
import Foundation
import JarvisCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit

enum ActivitySheetKind: String, Identifiable {
    case background
    case needsYou

    var id: String { rawValue }
    var title: String { self == .background ? "Background activity" : "Needs you" }
}

private enum ChatSheet: Identifiable {
    case activity(ActivitySheetKind)
    case camera

    var id: String {
        switch self {
        case .activity(let kind): "activity-\(kind.id)"
        case .camera: "camera"
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
                .accessibilityIdentifier("chat.notifications")
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSidebarMenuButton(language: appLanguage)
            }
            .sharedBackgroundVisibility(.hidden)
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
            case .camera:
                if let cameraCapture {
                    JarvisChatCameraSheet(
                        camera: cameraCapture,
                        language: appLanguage,
                        copyText: copy,
                        closeTitle: copy(.close),
                        takePhotoTitle: copy(.takePhoto),
                        takingPhotoTitle: copy(.takingPhoto),
                        isCapturingPhoto: isCapturingPhoto,
                        onCapture: captureCameraPhoto,
                        onCancel: cancelCameraPhoto,
                        onVideo: switchCameraSheetToVideo
                    )
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
                }
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
        .onAppear(perform: refreshScreenSharing)
        .task(id: screenShare.isBusy) {
            while screenShare.isBusy && !Task.isCancelled {
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
                .defaultScrollAnchor(.bottom)
                .scrollEdgeEffectStyle(.soft, for: .top)
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
            if model.shouldShowNowBar {
                nowBar
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
            VStack(spacing: 0) {
                TextField(copy(.messagePlaceholder), text: $model.draft, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...JarvisDesignTokens.chatComposerMaximumLines)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit(sendMessage)
                    .disabled(model.isSending || model.fixtureTurnUnavailable)
                    .padding(.horizontal, JarvisDesignTokens.chatComposerTextInset)
                    .padding(.top, JarvisDesignTokens.chatComposerTextInset)
                    .padding(.bottom, JarvisDesignTokens.chatComposerSpacing / 2)
                    .accessibilityLabel(copy(.messagePlaceholder))
                    .accessibilityIdentifier("chat.input")
                    .accessibilityHint(model.fixtureTurnUnavailable ? "The fixture supports one sample turn." : "")

                HStack(spacing: 0) {
                    plusMenu
                    Spacer(minLength: 0)
                    dictateButton
                    trailingButton
                }
            }
            .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing / 2)
            .padding(.bottom, JarvisDesignTokens.chatComposerSpacing / 2)
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

    private var dictateButton: some View {
        Button(action: toggleDictation) {
            Image(systemName: dictation.isListening ? "stop.circle.fill" : "mic")
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .regular))
                .foregroundStyle(
                    dictation.isListening ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent
                )
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.isSending || model.fixtureMode)
        .accessibilityLabel(copy(dictation.isListening ? .stopDictation : .dictate))
        .accessibilityIdentifier("chat.dictate")
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
        if model.isSending {
            Button {
                Task { await model.cancel() }
            } label: {
                Group {
                    if model.isCancelling {
                        ProgressView()
                    } else {
                        Image(systemName: "stop.fill")
                            .font(.system(size: JarvisDesignTokens.chatComposerIconSize - 4, weight: .semibold))
                            .foregroundStyle(JarvisDesignTokens.primaryAccent)
                    }
                }
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.fixtureMode || model.isCancelling || !model.canCancel)
            .accessibilityLabel(model.isCancelling ? "Cancelling turn" : "Stop response")
            .accessibilityIdentifier("chat.stop")
            .accessibilityHint(model.fixtureMode ? "Cancellation is disabled with fixture data." : "")
        } else if model.canSend {
            trailingDisc(symbol: "arrow.up", isSend: true, action: {
                dictation.stop()
                sendMessage()
            })
            .accessibilityLabel(copy(.sendMessage))
            .accessibilityIdentifier("chat.send")
            .accessibilityHint(sendHint)
        } else {
            trailingDisc(symbol: "waveform", isSend: false, action: {
                dictation.stop()
                onNavigate(.voice)
            })
            .accessibilityLabel(copy(.voiceMode))
            .accessibilityIdentifier("chat.mode")
        }
    }

    private func trailingDisc(symbol: String, isSend: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize - 4, weight: .bold))
                .foregroundStyle(
                    isSend ? JarvisDesignTokens.primaryAccentForeground : JarvisDesignTokens.secondaryAccent
                )
                .frame(
                    width: JarvisDesignTokens.chatComposerSendDiameter,
                    height: JarvisDesignTokens.chatComposerSendDiameter
                )
                .background(
                    isSend ? JarvisDesignTokens.primaryAccent : JarvisDesignTokens.secondaryAccent.opacity(0.16),
                    in: Circle()
                )
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var videoTile: some View {
        if isVideoEnabled, let cameraCapture {
            ZStack(alignment: .topTrailing) {
                VoiceCameraPreview(session: cameraCapture.session)
                    .accessibilityLabel(copy(.videoOn))
                Button(action: stopVideo) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(.black.opacity(0.5), in: Circle())
                        .frame(
                            width: JarvisDesignTokens.chatMinimumTapTarget,
                            height: JarvisDesignTokens.chatMinimumTapTarget
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy(.disableVideo))
                .accessibilityIdentifier("video.stop")
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
        Menu {
            Menu {
                voiceLanguageOption(.da, title: copy(.danish))
                voiceLanguageOption(.en, title: copy(.english))
            } label: {
                Label(copy(.voiceLanguage), systemImage: "globe")
            }
            .disabled(model.fixtureMode || model.isSending)
            Button(
                isScreenSharing ? copy(.stopSharingScreen) : copy(.shareScreen),
                systemImage: isScreenSharing ? "stop.circle" : "rectangle.on.rectangle"
            ) {
                deferred {
                    if isScreenSharing { stopScreenSharing() } else { openScreenSharePicker() }
                }
            }
            .accessibilityIdentifier("chat.plus.screenShare")
            .disabled(model.fixtureMode || screenShare.state == .starting)
            Button(
                isVideoEnabled ? copy(.disableVideo) : copy(.enableVideo),
                systemImage: isVideoEnabled ? "video.slash" : "video"
            ) {
                deferred(toggleVideo)
            }
            .accessibilityIdentifier("chat.plus.video")
            .disabled(model.fixtureMode)
            Menu {
                Button(copy(.chooseFiles), systemImage: "doc") {
                    deferred { fileImporterPresented = true }
                }
                Button(copy(.photoLibrary), systemImage: "photo.on.rectangle") {
                    deferred { photosPickerPresented = true }
                }
            } label: {
                Label(copy(.attach), systemImage: "paperclip")
            }
            .accessibilityIdentifier("chat.plus.attach")
            .disabled(model.fixtureMode || model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount)
            Button(copy(.camera), systemImage: "camera") {
                deferred(openCameraForPhoto)
            }
            .accessibilityIdentifier("chat.plus.camera")
            .disabled(
                (model.fixtureMode && !usesCameraStub)
                    || model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount
            )
        } label: {
            Image(systemName: "plus")
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .regular))
                .foregroundStyle(JarvisDesignTokens.primaryAccent)
                .frame(
                    width: JarvisDesignTokens.chatMinimumTapTarget,
                    height: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .tint(JarvisDesignTokens.secondaryAccent)
        .menuOrder(.fixed)
        .disabled(model.isSending || isPreparingCamera)
        .accessibilityLabel(copy(.plusMenuLabel))
        .accessibilityIdentifier("chat.plus")
        .accessibilityHint(copy(isPreparingCamera ? .cameraStarting : .plusMenuHint))
    }

    private func deferred(_ action: @escaping () -> Void) {
        Task { @MainActor in
            await Task.yield()
            action()
        }
    }

    private func voiceLanguageOption(_ language: ChatLanguage, title: String) -> some View {
        Button {
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

    private var screenShareStatus: (text: String, symbol: String, isError: Bool)? {
        switch screenShare.state {
        case .idle: nil
        case .starting: (copy(.screenShareStarting), "dot.radiowaves.left.and.right", false)
        case .live: (copy(.screenSharingActive), "dot.radiowaves.left.and.right", false)
        case .stopped: (copy(.screenShareStopped), "stop.circle", false)
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

    private func switchCameraSheetToVideo() {
        guard cameraCapture != nil else { return }
        stopCameraAfterPhoto = false
        isCapturingPhoto = false
        presentedSheet = nil
        isVideoEnabled = true
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
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
    }

    private func approvalBar(_ confirmation: PendingConfirmation) -> some View {
        HStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            approvalButton(confirmation, decision: .reject)
                .buttonStyle(.glass)
                .tint(JarvisDesignTokens.secondaryAccent)
                .accessibilityIdentifier("now-confirmation-decline-\(confirmation.id)")
            approvalButton(confirmation, decision: .approve)
                .buttonStyle(.glassProminent)
                .tint(JarvisDesignTokens.primaryAccent)
                .accessibilityIdentifier("now-confirmation-approve-\(confirmation.id)")
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
        return Button {
            Task { await model.resolve(confirmation, decision: decision) }
        } label: {
            HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                if isPending {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityHidden(true)
                }
                Text(isPending
                     ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
                     : actionLabel)
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Rectangle())
        }
        .disabled(model.fixtureMode || model.isResolving(confirmation))
        .accessibilityLabel(actionLabel)
        .accessibilityValue(isPending
            ? JarvisApprovalLocalization.string(.sending, language: appLanguage)
            : "")
        .accessibilityHint(model.fixtureMode
            ? (appLanguage == .da ? "Godkendelse er deaktiveret med eksempeldata." : "Approval actions are disabled with fixture data.")
            : "")
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

private struct JarvisCameraControls: View {
    let camera: VoiceCameraCapture
    let language: JarvisAppLanguage
    var usesTorch = false
    @State private var flash: AVCaptureDevice.FlashMode = .auto
    @State private var torchOn = false
    @State private var position: AVCaptureDevice.Position
    @State private var lens: VoiceCameraLens
    @State private var lenses: [VoiceCameraLens]

    init(camera: VoiceCameraCapture, language: JarvisAppLanguage, usesTorch: Bool = false) {
        self.camera = camera
        self.language = language
        self.usesTorch = usesTorch
        _flash = State(initialValue: camera.flashMode)
        _position = State(initialValue: camera.position)
        _lens = State(initialValue: camera.lens)
        _lenses = State(initialValue: VoiceCameraCapture.availableLenses(position: camera.position))
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }

    private var lightSymbol: String {
        if usesTorch { return torchOn ? "bolt.fill" : "bolt.slash" }
        switch flash {
        case .on: return "bolt.fill"
        case .off: return "bolt.slash"
        default: return "bolt.badge.automatic"
        }
    }

    private var lightLabel: String {
        if usesTorch { return copy(torchOn ? .torchOff : .torchOn) }
        switch flash {
        case .on: return copy(.flashOn)
        case .off: return copy(.flashOff)
        default: return copy(.flashAuto)
        }
    }

    private func toggleLight() {
        if usesTorch {
            torchOn.toggle()
            camera.setTorch(torchOn)
        } else {
            flash = flash == .auto ? .on : (flash == .on ? .off : .auto)
            camera.flashMode = flash
        }
    }

    private var flipTarget: AVCaptureDevice.Position { position == .front ? .back : .front }

    var body: some View {
        HStack(spacing: 6) {
            if usesTorch ? camera.hasTorch : camera.hasFlash {
                Button(action: toggleLight) {
                    control { Image(systemName: lightSymbol) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(lightLabel)
                .accessibilityIdentifier("camera.flash")
            }
            if VoiceCameraCapture.hasCamera(position: flipTarget) {
                Button(action: flip) {
                    control { Image(systemName: "camera.rotate") }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy(.flipCamera))
                .accessibilityIdentifier("camera.flip")
            }
            if lenses.count > 1 {
                Menu {
                    Picker(copy(.cameraLens), selection: lensSelection) {
                        ForEach(lenses) { option in
                            Text(copy(option.localizationKey)).tag(option)
                        }
                    }
                } label: {
                    control { Text(shortTitle(lens)).font(.caption.weight(.semibold)) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copy(.cameraLens))
                .accessibilityValue(copy(lens.localizationKey))
                .accessibilityIdentifier("camera.lens")
            }
        }
    }

    private func control<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .foregroundStyle(.white)
            .frame(minWidth: 34, minHeight: 34)
            .background(.black.opacity(0.5), in: Capsule())
            .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Rectangle())
    }

    private func shortTitle(_ lens: VoiceCameraLens) -> String {
        switch lens {
        case .ultraWide: "0.5×"
        case .wide: "1×"
        case .telephoto: "2×"
        }
    }

    private var lensSelection: Binding<VoiceCameraLens> {
        Binding(get: { lens }, set: { select(position: position, lens: $0) })
    }

    private func flip() {
        let target = flipTarget
        let available = VoiceCameraCapture.availableLenses(position: target)
        let preferred = available.contains(lens) ? lens : (available.contains(.wide) ? .wide : available.first)
        guard let preferred else { return }
        select(position: target, lens: preferred)
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
}

private enum CameraSheetMode { case photo, video }

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
    let onVideo: () -> Void
    @State private var mode = CameraSheetMode.photo

    var body: some View {
        ZStack {
            JarvisScreenBackground()
            VoiceCameraPreview(session: camera.session)
                .ignoresSafeArea()
            VStack {
                HStack {
                    Button(closeTitle, systemImage: "xmark", action: onCancel)
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("camera.close")
                    Spacer()
                    JarvisCameraControls(camera: camera, language: language)
                }
                Spacer()
                Picker(copyText(.cameraMode), selection: $mode) {
                    Text(copyText(.modePhoto)).tag(CameraSheetMode.photo)
                    Text(copyText(.modeVideo)).tag(CameraSheetMode.video)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)
                .accessibilityIdentifier("camera.mode")
                .onChange(of: mode) { _, newMode in
                    if newMode == .video { onVideo() }
                }
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
                .accessibilityIdentifier("camera.shutter")
                .padding(.bottom, JarvisDesignTokens.voiceControlBottomInset)
            }
            .padding(JarvisDesignTokens.voiceStatusSpacing)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.cameraSheet")
    }
}
