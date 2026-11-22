import Foundation
import JarvisCore
import SwiftUI

/// Renders a note's Markdown body as readable native text: headings, checklists, bullets, quotes, code and
/// clickable internal links. Properties (frontmatter) never reach this view.
struct JarvisNoteBodyView: View {
    let document: JarvisNoteDocument
    let titleForTarget: (String) -> String?
    let onOpenTarget: (String) -> Void

    private func inline(_ text: String) -> AttributedString {
        let linked = JarvisNoteLinks.rewriteInternalLinks(text, titleForTarget: titleForTarget)
        return (try? AttributedString(
            markdown: linked,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        case 3: .title3.bold()
        default: .headline
        }
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 6) {
            // Blocks get a fresh identity each parse, so rows are keyed by position.
            ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                row(block)
            }
        }
        .tint(JarvisDesignTokens.ambientCool)
        .environment(\.openURL, OpenURLAction { url in
            if let target = JarvisNoteLinks.target(of: url) {
                onOpenTarget(target)
                return .handled
            }
            return .systemAction
        })
    }

    @ViewBuilder
    private func row(_ block: JarvisNoteDocument.Block) -> some View {
        let trimmed = block.text.trimmingCharacters(in: .whitespaces)
        if block.isCode {
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                EmptyView()
            } else {
                Text(block.text.isEmpty ? " " : block.text)
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
            }
        } else if block.prefix.isEmpty && trimmed.isEmpty {
            Color.clear.frame(height: 6).accessibilityHidden(true)
        } else if block.headingLevel > 0 {
            Text(inline(block.text))
                .font(headingFont(block.headingLevel))
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
        } else if block.isChecklist {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: block.isChecked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(JarvisDesignTokens.notesTaskRing)
                    .accessibilityHidden(true)
                Text(inline(block.text))
                    .strikethrough(block.isChecked)
                    .foregroundStyle(block.isChecked ? Color.secondary : Color.primary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityValue(block.isChecked ? "Checked" : "Unchecked")
        } else if block.isBullet {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(block.prefix.trimmingCharacters(in: .whitespaces).first.map { $0.isNumber ? block.prefix.trimmingCharacters(in: .whitespaces) : "•" } ?? "•")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(inline(block.text))
            }
        } else if block.prefix.trimmingCharacters(in: .whitespaces) == ">" {
            Text(inline(block.text))
                .italic()
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
        } else {
            Text(inline(block.text)).font(.body)
        }
    }
}

/// The reader: title, compact folder provenance and rendered Markdown, with a reachable Close / Edit row.
struct JarvisNoteReaderView: View {
    let client: JarvisNotesClient?
    let copy: JarvisNotesCopy
    let language: JarvisAppLanguage
    let graph: KnowledgeGraph?
    let isPinned: Bool
    let onPin: (Bool) -> Void
    let onDeleted: (String) -> Void
    let onNoteChanged: (VaultNote) -> Void
    let onOpenPath: (String) -> Void
    let onRetryGraph: () -> Void
    let onClose: () -> Void

    @State private var note: VaultNote
    @State private var editing = false
    @State private var connectionsPresented = false
    @State private var deletePresented = false
    @State private var deleting = false
    @State private var message: String?

    init(
        client: JarvisNotesClient?, copy: JarvisNotesCopy, language: JarvisAppLanguage, note: VaultNote,
        graph: KnowledgeGraph?, isPinned: Bool, onPin: @escaping (Bool) -> Void,
        onDeleted: @escaping (String) -> Void, onNoteChanged: @escaping (VaultNote) -> Void,
        onOpenPath: @escaping (String) -> Void, onRetryGraph: @escaping () -> Void, onClose: @escaping () -> Void
    ) {
        self.client = client
        self.copy = copy
        self.language = language
        self.graph = graph
        self.isPinned = isPinned
        self.onPin = onPin
        self.onDeleted = onDeleted
        self.onNoteChanged = onNoteChanged
        self.onOpenPath = onOpenPath
        self.onRetryGraph = onRetryGraph
        self.onClose = onClose
        _note = State(initialValue: note)
    }

    private var parts: JarvisNoteParts { JarvisNoteParts(note.content) }
    private var title: String { JarvisNoteTitle.title(content: note.content, path: note.path) }
    private var location: String {
        let value = JarvisNoteTitle.location(path: note.path)
        return value.isEmpty ? copy.vaultRoot : value
    }

    var body: some View {
        let titles = Dictionary((graph?.nodes ?? []).map { ($0.path, $0.title) }, uniquingKeysWith: { first, _ in first })
        let paths = Set(titles.keys)
        ScrollView {
            VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                Text(title)
                    .font(.largeTitle.bold())
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("reader.title")
                Label(location, systemImage: "folder")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("reader.location")
                if let message {
                    Text(message).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("reader.message")
                }
                JarvisNoteBodyView(
                    document: JarvisNoteDocument(parts.readableBody),
                    titleForTarget: { target in
                        JarvisNoteLinks.resolve(target, from: note.path, paths: paths).flatMap { titles[$0] }
                    },
                    onOpenTarget: openTarget
                )
                .padding(.top, 4)
                JarvisRowGroup {
                    JarvisDetailRow(
                        title: copy[.linkedNotes], identifier: "reader.linked",
                        action: { connectionsPresented = true }
                    )
                }
                .padding(.top, JarvisDesignTokens.notesSectionSpacing)
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.bottom, JarvisDesignTokens.notesSectionSpacing)
        }
        .jarvisPageHeader {
            JarvisPageHeader(
                title: "", language: language,
                leading: AnyView(JarvisIconButton(title: copy.back, systemImage: "chevron.left", identifier: "reader.back", isDisabled: deleting, action: onClose))
            ) {
                JarvisMenuButton(title: copy[.more], systemImage: "ellipsis", identifier: "reader.more", isDisabled: deleting) {
                    Button { onPin(!isPinned) } label: {
                        Label(isPinned ? copy.unpin : copy.pin, systemImage: isPinned ? "pin.slash" : "pin")
                    }
                    Button { connectionsPresented = true } label: {
                        Label(copy[.viewConnections], systemImage: "point.3.connected.trianglepath.dotted")
                    }
                    Button(role: .destructive) { deletePresented = true } label: {
                        Label(copy[.deleteNote], systemImage: "trash")
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: JarvisDesignTokens.notesSectionSpacing) {
                JarvisLabelledButton(title: copy[.close], identifier: "reader.close", isDisabled: deleting, isFullWidth: true, action: onClose)
                JarvisLabelledButton(
                    title: copy.edit, identifier: "reader.edit", isBusy: deleting, isDisabled: client == nil,
                    isFullWidth: true, isEmphasised: true
                ) { editing = true }
            }
            .padding(.horizontal, JarvisDesignTokens.notesHorizontalInset)
            .padding(.vertical, JarvisDesignTokens.notesSectionSpacing)
        }
        .jarvisPageBackground()
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .task {
#if targetEnvironment(simulator)
            // CI captures only: open the editor from the reader.
            if ProcessInfo.processInfo.arguments.contains("--screenshot-notes-open-editor") {
                try? await Task.sleep(for: .seconds(1))
                editing = true
            }
#endif
        }
        .sheet(isPresented: $editing) {
            if let client {
                JarvisNoteEditorSheet(client: client, copy: copy, mode: .edit(note)) { refreshed in
                    note = refreshed
                    onNoteChanged(refreshed)
                }
            }
        }
        .sheet(isPresented: $connectionsPresented) {
            connectionsSheet
        }
        .confirmationDialog(copy[.deleteNoteTitle], isPresented: $deletePresented, titleVisibility: .visible) {
            Button(copy[.deleteNote], role: .destructive) { Task { await delete() } }
            Button(copy.cancel, role: .cancel) {}
        } message: {
            Text(copy[.deleteNoteMessage])
        }
    }

    private var connectionsSheet: some View {
        let connections = graph.map { JarvisNoteLinks.connections(of: note.path, in: $0) }
        return JarvisConnectionsSheet(
            copy: copy, title: copy[.linkedNotes],
            sections: connections.map { [
                JarvisConnectionsSection(title: copy[.linksInThisNote], nodes: $0.outgoing),
                JarvisConnectionsSection(title: copy[.notesLinkingHere], nodes: $0.incoming),
            ] } ?? [],
            emptyText: graph == nil ? copy[.graphUnavailable] : copy[.noConnections],
            showsEmptyForAll: graph != nil && connections?.outgoing.isEmpty == true && connections?.incoming.isEmpty == true,
            onRetry: graph == nil ? onRetryGraph : nil,
            onOpen: { path in
                connectionsPresented = false
                onOpenPath(path)
            },
            onClose: { connectionsPresented = false }
        )
    }

    private func openTarget(_ target: String) {
        guard let graph,
              let path = JarvisNoteLinks.resolve(target, from: note.path, paths: Set(graph.nodes.map(\.path))) else {
            message = copy.noteMissing
            return
        }
        message = nil
        onOpenPath(path)
    }

    @MainActor
    private func delete() async {
        guard let client, !deleting else { return }
        deleting = true
        message = nil
        defer { deleting = false }
        do {
            try await client.deleteNote(path: note.path, sha: note.sha)
            onDeleted(note.path)
        } catch JarvisNotesClientError.noteConflict {
            message = copy[.deleteChanged]
        } catch {
            message = copy[.deleteFailed]
        }
    }
}

struct JarvisConnectionsSection: Identifiable {
    let title: String
    let nodes: [KnowledgeGraphNode]
    var id: String { title }
}

/// The accessible list of linked notes, also used by the graph's List command. Each row shows its real path.
struct JarvisConnectionsSheet: View {
    let copy: JarvisNotesCopy
    let title: String
    let sections: [JarvisConnectionsSection]
    let emptyText: String
    var showsEmptyForAll = false
    var onRetry: (() -> Void)?
    let onOpen: (String) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
            HStack {
                Text(title).font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                JarvisSheetCloseButton(title: copy[.close], action: onClose)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                    if sections.isEmpty || showsEmptyForAll {
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.notesSectionSpacing) {
                            Text(emptyText).foregroundStyle(.secondary)
                            if let onRetry {
                                JarvisLabelledButton(title: copy.retry, identifier: "connections.retry", isEmphasised: true, action: onRetry)
                            }
                        }
                    }
                    ForEach(sections.filter { !$0.nodes.isEmpty }) { section in
                        Text(section.title).font(.headline).accessibilityAddTraits(.isHeader)
                        ForEach(section.nodes) { node in
                            JarvisRowGroup {
                                JarvisDetailRow(
                                    title: node.title, subtitle: node.path, systemImage: "doc.text",
                                    identifier: "connections.row.\(node.path)", action: { onOpen(node.path) }
                                )
                            }
                        }
                    }
                }
            }
            JarvisLabelledButton(title: copy.done, identifier: "connections.done", isFullWidth: true, isEmphasised: true, action: onClose)
        }
        .padding(JarvisDesignTokens.notesHorizontalInset)
        .jarvisAmbientBackground()
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("connections.sheet")
    }
}
