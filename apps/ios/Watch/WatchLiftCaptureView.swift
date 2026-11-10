import Combine
import Foundation
import JarvisCore
import SwiftUI

@MainActor
final class WatchLiftCaptureModel: ObservableObject {
    static let shared = WatchLiftCaptureModel()
    @Published private(set) var draft = WatchLiftCaptureDraft()
    @Published private(set) var error: String?
    @Published private(set) var storageAvailable = true
    private var store: WatchLiftCaptureStore?

    init() {
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
                draft = WatchLiftCaptureFixture.draft()
                return
            }
            #endif
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                       appropriateFor: nil, create: true)
            let store = try WatchLiftCaptureStore(fileURL: directory.appendingPathComponent("lift-capture.json"))
            self.store = store
            draft = store.draft
        } catch { storageFailure() }
    }

    func updateText(_ text: String) {
        guard storageAvailable else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            draft.updateText(text)
            return
        }
        #endif
        do { try store?.updateText(text); sync() } catch {
            draft.updateText(text)
            storageFailure()
        }
    }

    func save(connection: WatchConnection) async {
        guard storageAvailable, connection.reachable else { return }
        let submission: JarvisLiftCaptureRequest
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
                guard let request = draft.beginSubmission(reachable: connection.reachable) else { return }
                submission = request
            } else {
                guard let request = try store?.beginSubmission(reachable: connection.reachable) else { return }
                submission = request
                sync()
            }
            #else
            guard let request = try store?.beginSubmission(reachable: connection.reachable) else { return }
            submission = request
            sync()
            #endif
        } catch { storageFailure(); return }
        error = nil
        do {
            // Wire IDs identify individual attempts; the durable operation key
            // lives in the body and survives reconnects and clarifying edits.
            let reply = try await connection.request(.init(action: .captureLift, data: WatchCodec.encode(submission)))
            guard let data = reply.data else { throw WatchFailure.failed }
            let result = try JSONDecoder().decode(JarvisLiftCaptureResult.self, from: data)
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
                draft.receive(result)
                return
            }
            #endif
            do { try store?.receive(result); sync() } catch { storageFailure() }
        } catch {
            self.error = (error as? WatchFailure)?.message ?? "Could not confirm the save. Retry the same lift when connected."
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
                draft.failSubmission()
                return
            }
            #endif
            do { try store?.failSubmission(); sync() } catch { storageFailure() }
        }
    }

    func startAnother() {
        guard storageAvailable else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-fixture") {
            draft.startAnother()
            return
        }
        #endif
        do { try store?.startAnother(); sync(); error = nil } catch { storageFailure() }
    }

    private func sync() {
        if let store { draft = store.draft }
    }
    private func storageFailure() {
        storageAvailable = false
        error = "Could not preserve this draft safely. Restart Jarvis on your Watch before saving. Your pending lift has not been replaced."
    }
}

struct WatchLiftCaptureView: View {
    @EnvironmentObject private var connection: WatchConnection
    @EnvironmentObject private var model: WatchModel
    @StateObject private var capture = WatchLiftCaptureModel.shared
    var voice: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if case .saved(let entry, _) = capture.draft.result, capture.draft.phase == .saved {
                    Label("Saved", systemImage: "checkmark.circle.fill")
                        .font(.headline).foregroundStyle(WatchStyle.amber)
                    Text(entry.exerciseName).font(.body)
                    Text("\(entry.weightKg.formatted()) kg · \(entry.reps) reps × \(entry.sets) sets")
                        .font(.body).accessibilityLabel("\(entry.weightKg.formatted()) kilograms, \(entry.reps) repetitions, \(entry.sets) sets")
                    WatchPrimaryAction(title: "Log another lift", action: capture.startAnother)
                        .disabled(!capture.storageAvailable)
                } else if capture.draft.phase == .deleted {
                    Label("Lift deleted", systemImage: "trash").font(.headline)
                    Text("This lift was deleted. Check history before starting a new lift.").font(.body)
                    Text(capture.draft.text).font(.caption).foregroundStyle(.secondary)
                    WatchPrimaryAction(title: "Log another lift", action: capture.startAnother)
                        .disabled(!capture.storageAvailable)
                } else {
                    WatchTextInput(title: "Lift details", text: Binding(
                        get: { capture.draft.text },
                        set: { capture.updateText($0) }
                    ), multiline: true, alignment: .bottom)
                    .padding(10).modifier(WatchSurface())
                    .disabled(!capture.draft.canEdit || !capture.storageAvailable)
                    if capture.draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Enter exercise, weight and reps. Sets are optional.").font(.caption).foregroundStyle(.secondary)
                    } else if capture.draft.text.utf16.count > JarvisLiftCaptureRequest.maximumTextUTF16Count ||
                                capture.draft.text.utf8.count > JarvisLiftCaptureRequest.maximumTextBytes {
                        Text("Use up to 2,000 characters.").font(.caption).foregroundStyle(.secondary)
                    } else if JarvisLiftCaptureRequest.containsUnsupportedCharacters(in: capture.draft.text) {
                        Text("Remove unsupported invisible characters.").font(.caption).foregroundStyle(.secondary)
                    }
                    if case .needsDetails(let question) = capture.draft.result {
                        Text(question).font(.caption)
                    }
                    if capture.draft.phase == .uncertain {
                        Text("Save not confirmed. Retry checks the same lift; details stay locked to prevent duplicates.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    WatchPrimaryAction(title: saveTitle) {
                        Task { await capture.save(connection: connection) }
                    }
                    .disabled(!capture.draft.canSubmit || !capture.storageAvailable || !connection.reachable || model.voiceID != nil)
                    JarvisWatchAction(title: "Voice", kind: .voice, action: voice)
                        .disabled(!connection.reachable || capture.draft.phase == .submitting || capture.draft.phase == .uncertain)
                    if capture.draft.phase == .submitting {
                        HStack { ProgressView(); Text("Saving…").font(.caption) }
                    }
                    if model.voiceID != nil {
                        Text("End voice before saving a typed lift.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let error = capture.error {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                }
                if !connection.reachable {
                    Text("Open Jarvis on your iPhone to connect. Nothing is sent offline.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }.navigationTitle("Log lift")
    }

    private var saveTitle: String {
        capture.draft.phase == .uncertain ? "Retry save" : "Save"
    }
}

struct WatchLogLiftShortcut: View {
    var body: some View {
        NavigationLink(value: WatchRoute.logLift) {
            Label("Log lift", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        }.buttonStyle(.plain).foregroundStyle(WatchStyle.amber).accessibilityIdentifier("watch.logLift")
    }
}
