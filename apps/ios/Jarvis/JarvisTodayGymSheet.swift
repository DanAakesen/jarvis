import JarvisCore
import SwiftUI

/// Quick gym log: pick one of the five session types, optionally add a lift, and save it to the vault as a Gym log.
struct JarvisTodayGymSheet: View {
    private enum Status: Equatable {
        case idle
        case saving
        case saved
        case failed(JarvisTodayLocalizationKey)
    }

    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let startsWithLift: Bool

    @State private var session: JarvisGymSessionType?
    @State private var exercise = ""
    @State private var weight = ""
    @State private var reps = ""
    @State private var sets = ""
    @State private var status: Status = .idle
    @FocusState private var exerciseFocused: Bool

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    private var hasLiftInput: Bool {
        ![exercise, weight, reps, sets].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private var parsedLift: JarvisGymLift? {
        guard let kilos = Double(weight.replacingOccurrences(of: ",", with: ".")),
              let repCount = Int(reps), let setCount = Int(sets) else { return nil }
        let lift = JarvisGymLift(exercise: exercise, weightKg: kilos, reps: repCount, sets: setCount)
        return lift.isValid ? lift : nil
    }

    private var canSave: Bool {
        guard session != nil else { return false }
        switch status {
        case .saving, .saved, .failed(.saveOutcomeUnknown): return false
        default: break
        }
        return !hasLiftInput || parsedLift != nil
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section(copy(.sessionTypeGroup)) {
                    ForEach(JarvisGymSessionType.allCases) { option in
                        Button {
                            session = option
                            if status != .saving, status != .saved { status = .idle }
                        } label: {
                            HStack {
                                Text(option.title(language: language))
                                    .foregroundStyle(.primary)
                                Spacer(minLength: 8)
                                if session == option {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                                        .accessibilityHidden(true)
                                }
                            }
                            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(session == option ? .isSelected : [])
                        .accessibilityIdentifier("today.gym.session.\(option.rawValue)")
                    }
                }
                Section(copy(.quickLift)) {
                    TextField(copy(.exercise), text: $exercise)
                        .focused($exerciseFocused)
                        .accessibilityIdentifier("today.gym.exercise")
                    HStack(spacing: 12) {
                        TextField("kg", text: $weight)
                            .keyboardType(.decimalPad)
                            .accessibilityLabel("kg")
                            .accessibilityIdentifier("today.gym.weight")
                        TextField(copy(.reps), text: $reps)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("today.gym.reps")
                        TextField(copy(.sets), text: $sets)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("today.gym.sets")
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let message = statusMessage {
                    Label(message.text, systemImage: message.symbol)
                        .foregroundStyle(message.isError ? Color.red : Color.primary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.updatesFrequently)
                        .accessibilityIdentifier("today.gym.status")
                }
            }
            .navigationTitle(copy(.gymLog))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy(.save),
                    closeTitle: copy(.close),
                    isWorking: status == .saving,
                    isConfirmDisabled: !canSave,
                    onConfirm: { Task { await save() } },
                    onClose: { dismiss() }
                )
            }
        }
        .onAppear {
            if startsWithLift, !fixtureFocusSuppressed { exerciseFocused = true }
        }
        .accessibilityIdentifier("today.gym.sheet")
    }

    private var fixtureFocusSuppressed: Bool { model.isFixture }

    private struct StatusMessage {
        let text: String
        let symbol: String
        let isError: Bool
    }

    private var statusMessage: StatusMessage? {
        switch status {
        case .idle:
            return nil
        case .saving:
            return StatusMessage(text: copy(.saving), symbol: "arrow.triangle.2.circlepath", isError: false)
        case .saved:
            return StatusMessage(text: copy(.savedToVault), symbol: "checkmark.circle", isError: false)
        case .failed(let key):
            return StatusMessage(text: copy(key), symbol: "exclamationmark.triangle", isError: true)
        }
    }

    private func save() async {
        guard let session, canSave else { return }
        status = .saving
        do {
            try await model.saveGymLog(session: session, lift: hasLiftInput ? parsedLift : nil)
            status = .saved
        } catch let error as JarvisGymLogError {
            switch error {
            case .unavailable: status = .failed(.saveUnavailable)
            case .outcomeUnknown: status = .failed(.saveOutcomeUnknown)
            case .invalidEntry, .failed: status = .failed(.saveFailed)
            }
        } catch {
            status = .failed(.saveFailed)
        }
    }
}
