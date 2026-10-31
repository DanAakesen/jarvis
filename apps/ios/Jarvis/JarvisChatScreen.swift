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

private struct RenderedChatRow: Identifiable {
    let message: JarvisChatRow
    let showsTimestamp: Bool

    var id: String { message.id }
}

struct JarvisChatScreen: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @StateObject private var model: JarvisChatModel
    @State private var activitySheet: ActivitySheetKind?
    @State private var composerMode: ChatComposerMode = .chat
    @State private var attachmentDialog = false
    @State private var fileImporterPresented = false
    @State private var photosPickerPresented = false
    @State private var cameraPresented = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @FocusState private var composerFocused: Bool
    private let initialActivitySheet: ActivitySheetKind?
    let onNavigate: (JarvisDestination) -> Void

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

    private var layout: some View {
        VStack(spacing: 0) {
            conversation
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .navigationTitle("Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    activitySheet = .needsYou
                } label: {
                    Image(systemName: "bell")
                        .symbolVariant(model.needsYouCount > 0 ? .fill : .none)
                        .foregroundStyle(.primary)
                        .overlay(alignment: .topTrailing) {
                            if model.needsYouCount > 0 {
                                Text(model.needsYouCount > 99 ? "99+" : "\(model.needsYouCount)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(JarvisDesignTokens.primaryAccentForeground)
                                    .padding(.horizontal, JarvisDesignTokens.chatBadgeInset)
                                    .background(JarvisDesignTokens.primaryAccent, in: Capsule())
                                    .offset(x: JarvisDesignTokens.chatBadgeInset, y: -JarvisDesignTokens.chatBadgeInset)
                            }
                        }
                        .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                }
                .jarvisToolbarButtonStyle()
                .accessibilityLabel(model.needsYouCount > 0 ? "Needs you, \(model.needsYouCount)" : "Needs you")
            }
        }
        .task {
            await model.load()
            if let initialActivitySheet {
                activitySheet = initialActivitySheet
            }
            await model.watchActivity()
        }
        .sheet(item: $activitySheet) { sheet in
            JarvisActivitySheet(model: model, kind: sheet)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(JarvisDesignTokens.chatSheetCornerRadius)
        }
    }

    private var attachmentPickers: some View {
        layout
        .confirmationDialog("Add attachment", isPresented: $attachmentDialog, titleVisibility: .visible) {
            Button("Choose files") { fileImporterPresented = true }
            Button("Photo library") { photosPickerPresented = true }
            Button("Take photo", systemImage: "camera") { cameraPresented = true }
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                .accessibilityHint(UIImagePickerController.isSourceTypeAvailable(.camera) ? "" : "Camera is unavailable on this device.")
            Button("Share screen unavailable", systemImage: "rectangle.on.rectangle") {}
                .disabled(true)
                .accessibilityHint("The broadcast upload extension is not included.")
            Button("Cancel", role: .cancel) {}
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
        .sheet(isPresented: $cameraPresented) {
            JarvisCameraCapture(
                onCapture: { image in
                    if let data = image.jpegData(compressionQuality: JarvisDesignTokens.chatPhotoCompressionQuality) {
                        model.addAttachment(
                            name: "Photo \(model.pendingAttachments.count + 1).jpg",
                            contentType: "image/jpeg",
                            data: data
                        )
                    }
                    cameraPresented = false
                },
                onCancel: { cameraPresented = false }
            )
            .ignoresSafeArea()
        }
    }

    var body: some View {
        attachmentPickers
        .background(JarvisScreenBackground())
        .onChange(of: composerMode) { _, mode in
            guard mode == .voice else { return }
            composerMode = .chat
            onNavigate(.voice)
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
                                interrupted: false
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
                .onChange(of: model.messages.count) { _, _ in
                    guard !reduceMotion else { return }
                    withAnimation(.easeOut(duration: JarvisDesignTokens.chatMessageAnimationDuration)) {
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
            messageBubble(text: row.message.text, role: row.message.role, interrupted: row.message.interrupted)
            if !row.message.toolCalls.isEmpty {
                VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
                    ForEach(row.message.toolCalls, id: \.id) { tool in
                        HStack(spacing: JarvisDesignTokens.chatMessageSpacing) {
                            Image(systemName: tool.outcome == .ok ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(tool.outcome == .ok ? Color.secondary : Color.orange)
                                .accessibilityHidden(true)
                            Text(tool.tool.replacingOccurrences(of: "_", with: " "))
                            Spacer(minLength: 0)
                            Text(tool.outcome.rawValue.capitalized)
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, JarvisDesignTokens.chatGlassInset)
                .frame(maxWidth: .infinity, alignment: .leading)
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

    private func messageBubble(text: String, role: ConversationRole, interrupted: Bool) -> some View {
        let isUser = role == .dan
        let userBubbleShape = RoundedRectangle(
            cornerRadius: JarvisDesignTokens.chatUserBubbleRadius,
            style: .continuous
        )
        let content = VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            Text(text)
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
            } else {
                content
                    .padding(.vertical, JarvisDesignTokens.chatGlassInset)
                    .frame(maxWidth: JarvisDesignTokens.chatMessageMaximumWidth, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isUser ? "You" : "Jarvis"): \(text)")
    }

    private var composer: some View {
        VStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            nowBar
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
            HStack(alignment: .bottom, spacing: JarvisDesignTokens.chatComposerSpacing) {
                Button {
                    attachmentDialog = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .medium))
                        .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                }
                .buttonStyle(.glass)
                .disabled(
                    model.fixtureMode ||
                        model.isSending ||
                        model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount
                )
                .accessibilityLabel("Add attachment")
                .accessibilityHint(addAttachmentHint)

                TextField("Ask Jarvis", text: $model.draft, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...JarvisDesignTokens.chatComposerMaximumLines)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit(model.send)
                    .disabled(model.isSending || model.fixtureTurnUnavailable)
                    .accessibilityLabel("Message Jarvis")
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
                    Button(action: model.send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: JarvisDesignTokens.chatComposerIconSize, weight: .semibold))
                            .frame(minWidth: JarvisDesignTokens.chatMinimumTapTarget, minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!model.canSend)
                    .accessibilityLabel("Send message")
                    .accessibilityHint(sendHint)
                }
            }
            .padding(JarvisDesignTokens.chatComposerSpacing)
            .background {
                RoundedRectangle(cornerRadius: JarvisDesignTokens.chatComposerRadius)
                    .fill(reduceTransparency ? Color(uiColor: .secondarySystemBackground) : Color.clear)
                    .glassEffect(.regular, in: .rect(cornerRadius: JarvisDesignTokens.chatComposerRadius))
            }
            .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
            .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
        }
        .background(.bar)
    }

    private var addAttachmentHint: String {
        if model.fixtureMode { return "Attachments are disabled with fixture data." }
        if model.pendingAttachments.count >= ChatAttachmentLimits.maximumCount {
            return "Remove an attachment to add another."
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
                activitySheet = .background
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

private struct JarvisCameraCapture: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, onCancel: onCancel)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let onCapture: (UIImage) -> Void
        let onCancel: () -> Void

        init(onCapture: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) {
            self.onCapture = onCapture
            self.onCancel = onCancel
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            } else {
                onCancel()
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCancel()
        }
    }
}
