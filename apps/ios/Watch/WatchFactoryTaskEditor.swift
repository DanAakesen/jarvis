import JarvisCore
import SwiftUI

struct WatchFactoryTaskEditor: View {
    let project: FactoryProject
    var created: () -> Void
    @EnvironmentObject private var connection: WatchConnection
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var request = ""
    @State private var agent: FactoryAgent
    @State private var busy = false
    @State private var failure: String?
    @State private var submissions = WatchFactorySubmissions()
    init(project: FactoryProject, created: @escaping () -> Void) {
        self.project = project; self.created = created
        _agent = State(initialValue: project.defaultAgent)
    }
    private var draft: WatchFactoryDraft {
        .init(projectID: project.id, title: title, request: request, agent: agent)
    }
    var body: some View {
        Form {
            WatchTextInput(title: "Title", text: $title).disabled(busy)
            WatchTextInput(title: "Request", text: $request).disabled(busy)
            Picker("Agent", selection: $agent) {
                Text("Codex").tag(FactoryAgent.codex)
                Text("Copilot").tag(FactoryAgent.copilot)
            }.disabled(busy)
            if title.utf16.count > 200 { Text("Keep the title within 200 characters.").font(.caption) }
            if request.utf8.count > 8_000 { Text("This request is too long for Watch. Continue on iPhone.").font(.caption) }
            if !connection.reachable { Text(WatchFailure.unavailable.message).font(.footnote) }
            if let failure { Text(failure).font(.footnote) }
            Button(busy ? "Starting…" : "Start task") { Task { await submit() } }
                .disabled(busy || !draft.isValid || !connection.reachable)
        }.navigationTitle("New task")
        .interactiveDismissDisabled(busy)
        .watchCaptureReady("new-task")
    }
    private func submit() async {
        guard !busy, connection.reachable else { return }
        guard let value = submissions.submission(for: draft),
              let id = UUID(uuidString: value.submissionId) else {
            failure = "Check the request. If too many drafts were attempted, reopen New task."; return
        }
        busy = true; failure = nil; defer { busy = false }
        do {
            _ = try await connection.request(.init(action: .createFactoryTask, itemID: project.id,
                                                  data: WatchCodec.encode(value), id: id))
            created(); dismiss()
        } catch {
            failure = (error as? WatchFailure)?.message ?? "Could not confirm the task. Your draft is kept."
            failure = (failure ?? "") + " Check project tasks before retrying. An unchanged retry uses the same submission."
        }
    }
}
