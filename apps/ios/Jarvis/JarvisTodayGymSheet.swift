import JarvisCore
import SwiftUI

/// Home and Health share the same dated workout and lift forms.
struct JarvisTodayGymSheet: View {
    enum Kind { case workout, lift }

    private enum Status: Equatable {
        case idle
        case saving
        case saved
        case failed(JarvisTodayLocalizationKey)
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var formHeight: CGFloat = 0
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let kind: Kind

    @State private var session: JarvisGymSessionType?
    @State private var liftName = ""
    @State private var manualSession: JarvisGymSessionType = .chest
    @State private var memory = JarvisLiftNameMemory.load()
    @State private var weight = ""
    @State private var reps = ""
    @State private var sets = ""
    @State private var date: Date?
    @State private var status: Status = .idle

    init(model: JarvisTodayModel, language: JarvisAppLanguage, kind: Kind) {
        self.model = model
        self.language = language
        self.kind = kind
        _date = State(initialValue: model.now)
    }

    private var prefix: String { kind == .workout ? "today.workout" : "today.lift" }

    private func copy(_ key: JarvisTodayLocalizationKey) -> String {
        JarvisTodayLocalization.string(key, language: language)
    }

    private var trimmedName: String { liftName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var knownSession: JarvisGymSessionType? { memory.session(for: trimmedName) }
    private var liftSession: JarvisGymSessionType { knownSession ?? manualSession }

    private var parsedLift: JarvisGymLift? {
        guard !trimmedName.isEmpty,
              let kilos = Double(weight.replacingOccurrences(of: ",", with: ".")),
              let repCount = Int(reps), let setCount = Int(sets) else { return nil }
        let lift = JarvisGymLift(exercise: trimmedName, weightKg: kilos, reps: repCount, sets: setCount)
        return lift.isValid ? lift : nil
    }

    private var canSave: Bool {
        guard date != nil else { return false }
        switch status {
        case .saving, .saved, .failed(.saveOutcomeUnknown): return false
        default: break
        }
        switch kind {
        case .workout: return session != nil
        case .lift: return parsedLift != nil
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { date ?? model.now }, set: { date = $0 })
    }

    private func resetStatus() {
        if status != .saving, status != .saved { status = .idle }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DatePicker(copy(.logDate), selection: dateBinding, in: ...model.now, displayedComponents: .date)
                        .environment(\.locale, language.locale)
                        .accessibilityIdentifier("today.log.date")
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .jarvisDashboardSurface()
                    if kind == .lift {
                        liftFields
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(copy(.sessionTypeGroup)).font(.headline)
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: dynamicTypeSize.isAccessibilitySize ? 1 : 2), alignment: .leading) {
                                ForEach(JarvisGymSessionType.loggable) { option in
                                    choiceRow(title: option.title(language: language), isSelected: session == option,
                                              identifier: "today.workout.session.\(option.rawValue)") { session = option }
                                }
                            }
                        }
                        .padding()
                        .jarvisDashboardSurface()
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { formHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .jarvisAmbientBackground()
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let message = statusMessage {
                    Label(message.text, systemImage: message.symbol)
                        .foregroundStyle(message.isError ? Color.red : Color.primary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.updatesFrequently)
                        .accessibilityIdentifier("today.log.status")
                        .id(status == .saved)
                        .transition(reduceMotion ? .identity : .opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .navigationTitle(copy(kind == .workout ? .logWorkout : .logLift))
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
        .presentationDetents([.height(formHeight > 0 ? formHeight + 66 + (statusMessage == nil ? 0 : 48) : 390), .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("\(prefix).sheet")
        .interactiveDismissDisabled(status == .saving)
        .animation(reduceMotion ? nil : .easeOut(duration: JarvisDesignTokens.filterAnimationDuration), value: status)
        .sensoryFeedback(.success, trigger: status == .saved) { _, saved in saved }
    }

    private var liftFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(copy(.liftName)).font(.headline)
            TextField(copy(.liftName), text: $liftName)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.sentences)
                .accessibilityIdentifier("today.lift.name")
                .onChange(of: liftName) { resetStatus() }
            let suggestions = memory.suggestions(matching: liftName, language: language)
            if !suggestions.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: JarvisDesignTokens.notesChipSpacing) {
                        ForEach(suggestions) { suggestion in
                            JarvisLabelledButton(title: suggestion.name, identifier: "today.lift.suggestion.\(suggestion.id)", isCompact: true) {
                                liftName = suggestion.name
                                resetStatus()
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            if !trimmedName.isEmpty, knownSession == nil {
                LabeledContent(copy(.sessionTypeGroup)) {
                    Picker(copy(.sessionTypeGroup), selection: $manualSession) {
                        ForEach(JarvisGymSessionType.loggable) { option in
                            Text(option.title(language: language)).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("today.lift.session")
                }
            }
            Divider()
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading)) : AnyLayout(HStackLayout(spacing: 12))
            layout {
                numberField("kg", text: $weight, keyboard: .decimalPad, id: "weight")
                numberField(copy(.reps), text: $reps, keyboard: .numberPad, id: "reps")
                numberField(copy(.sets), text: $sets, keyboard: .numberPad, id: "sets")
            }
        }
        .padding()
        .jarvisDashboardSurface()
    }

    private func numberField(_ title: String, text: Binding<String>, keyboard: UIKeyboardType, id: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            TextField("—", text: text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
                .accessibilityLabel(title)
                .accessibilityIdentifier("today.lift.\(id)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func choiceRow(
        title: String, isSelected: Bool, identifier: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
            resetStatus()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? JarvisDesignTokens.primaryAccent : Color.secondary)
                    .accessibilityHidden(true)
                Text(title).font(.subheadline).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: JarvisDesignTokens.chatMinimumTapTarget, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

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
        guard let date, canSave else { return }
        let target = kind == .workout ? session : liftSession
        guard let target else { return }
        status = .saving
        do {
            try await model.saveGymLog(
                session: target, lift: kind == .lift ? parsedLift : nil, on: date
            )
            status = .saved
            if kind == .lift {
                memory.record(name: trimmedName, session: liftSession)
                memory.save()
            }
            dismiss()
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
