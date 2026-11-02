import JarvisCore
import SwiftUI

/// Log a workout. Saving goes through `JarvisWorkoutLogging`; with no logger (the endpoint from issue 1529 is not
/// wired yet) the sheet cannot save and says so.
struct JarvisHealthNewWorkoutSheet: View {
    let logger: (any JarvisWorkoutLogging)?
    let language: JarvisAppLanguage
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var type: JarvisWorkoutType = .chestTricepsCore
    @State private var duration = ""
    @State private var submissionID = UUID()
    @State private var submittedDraft: JarvisWorkoutDraft?
    @State private var saving = false
    @State private var failed = false
    @State private var saveVersion = 0

    private var copy: JarvisHealthCopy { JarvisHealthCopy(language: language) }
    private var draft: JarvisWorkoutDraft? {
        let trimmed = duration.trimmingCharacters(in: .whitespacesAndNewlines)
        let minutes = trimmed.isEmpty ? nil : Int(trimmed)
        guard trimmed.isEmpty || minutes != nil else { return nil }
        let value = JarvisWorkoutDraft(idempotencyKey: submissionID, type: type, durationMinutes: minutes)
        return value.isValid ? value : nil
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section(copy.text(.workoutType)) {
                    Picker(copy.text(.workoutType), selection: $type) {
                        ForEach(JarvisWorkoutType.allCases) { item in
                            Text(copy.text(item.localizationKey)).tag(item)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .accessibilityIdentifier("health.workout.type")
                }
                .disabled(submittedDraft != nil)
                Section {
                    TextField(copy.text(.workoutDuration), text: $duration)
                        .keyboardType(.numberPad)
                        .accessibilityIdentifier("health.workout.duration")
                }
                .disabled(submittedDraft != nil)
                if logger == nil {
                    Text(copy.text(.workoutUnavailable))
                        .foregroundStyle(.secondary)
                }
                if failed {
                    Text(copy.text(.saveFailed))
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .navigationTitle(copy.text(.newWorkout))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy.text(.save),
                    closeTitle: copy.text(.cancel),
                    isWorking: saving,
                    isConfirmDisabled: logger == nil || (submittedDraft ?? draft) == nil,
                    onConfirm: {
                        submittedDraft = submittedDraft ?? draft
                        saving = true
                        failed = false
                        saveVersion += 1
                    },
                    onClose: { dismiss() }
                )
            }
        }
        .environment(\.locale, language.locale)
        .tint(JarvisDesignTokens.healthAccent)
        .interactiveDismissDisabled(saving)
        .task(id: saveVersion) {
            guard saveVersion > 0, let logger, let submittedDraft else { return }
            do {
                try await logger.logWorkout(submittedDraft)
                try Task.checkCancellation()
                onSaved()
                dismiss()
            } catch {
                failed = true
            }
            saving = false
        }
    }
}
