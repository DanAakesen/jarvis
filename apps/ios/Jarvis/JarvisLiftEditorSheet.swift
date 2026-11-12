import JarvisCore
import SwiftUI

struct JarvisLiftEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let lift: JarvisEditableLift
    let language: JarvisAppLanguage
    let onSave: (JarvisLiftEdit) async throws -> Void
    @State private var name: String
    @State private var weight: String
    @State private var reps: String
    @State private var sets: String
    @State private var saving = false
    @State private var failed = false

    init(lift: JarvisEditableLift, language: JarvisAppLanguage, onSave: @escaping (JarvisLiftEdit) async throws -> Void) {
        self.lift = lift
        self.language = language
        self.onSave = onSave
        _name = State(initialValue: lift.value.exerciseName)
        _weight = State(initialValue: lift.value.weightKg.formatted(.number.locale(language.locale).grouping(.never)))
        _reps = State(initialValue: String(lift.value.reps))
        _sets = State(initialValue: String(lift.value.sets))
    }

    private var edit: JarvisLiftEdit? {
        guard let kg = Double(weight.replacingOccurrences(of: ",", with: ".")),
              let r = Int(reps), let s = Int(sets) else { return nil }
        if case .vault = lift.source, kg <= 0 { return nil }
        let value = JarvisLiftEdit(exerciseName: name, weightKg: kg, reps: r, sets: s)
        return value.isValid ? value : nil
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    field("Exercise", text: $name, id: "name", keyboard: .default)
                    field("Weight (kg)", text: $weight, id: "weight", keyboard: .decimalPad)
                    field("Reps", text: $reps, id: "reps", keyboard: .numberPad)
                    field("Sets", text: $sets, id: "sets", keyboard: .numberPad)
                }
                if failed {
                    Text("The change could not be confirmed. Close and refresh lifts before trying again.")
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("health.lift.edit.error")
                }
            }
            .disabled(saving)
            .navigationTitle("Edit lift")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: "Save", closeTitle: "Close",
                    isWorking: saving, isConfirmDisabled: edit == nil || edit == lift.value || failed,
                    onConfirm: { Task { await save() } }, onClose: { dismiss() }
                )
            }
            .jarvisAmbientBackground(transparentNavigationBar: true)
        }
        .interactiveDismissDisabled(saving)
    }

    private func field(_ label: String, text: Binding<String>, id: String, keyboard: UIKeyboardType) -> some View {
        LabeledContent(label) {
            TextField(label, text: text)
                .multilineTextAlignment(.trailing)
                .keyboardType(keyboard)
                .accessibilityLabel(label)
                .accessibilityIdentifier("health.lift.edit.\(id)")
        }
    }

    private func save() async {
        guard !saving, !failed, let edit else { return }
        saving = true
        defer { saving = false }
        do { try await onSave(edit); dismiss() }
        catch { failed = true }
    }
}
