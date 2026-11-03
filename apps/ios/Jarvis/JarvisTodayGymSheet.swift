import JarvisCore
import SwiftUI

/// Home log sheets. Log workout shows the session types; Log lift shows the lifts. Both carry a date field
/// (default today) and nothing is saved until a date is set. Saving goes through the existing vault path.
struct JarvisTodayGymSheet: View {
    enum Kind { case workout, lift }

    private enum Status: Equatable {
        case idle
        case saving
        case saved
        case failed(JarvisTodayLocalizationKey)
    }

    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: JarvisTodayModel
    let language: JarvisAppLanguage
    let kind: Kind

    @State private var session: JarvisGymSessionType?
    @State private var liftType: JarvisGymLiftType?
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

    private var parsedLift: JarvisGymLift? {
        guard let liftType,
              let kilos = Double(weight.replacingOccurrences(of: ",", with: ".")),
              let repCount = Int(reps), let setCount = Int(sets) else { return nil }
        let lift = JarvisGymLift(
            exercise: liftType.title(language: language), weightKg: kilos, reps: repCount, sets: setCount
        )
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
            JarvisForm {
                Section {
                    if date != nil {
                        DatePicker(copy(.logDate), selection: dateBinding, in: ...model.now, displayedComponents: .date)
                            .environment(\.locale, language.locale)
                            .accessibilityIdentifier("today.log.date")
                        HStack {
                            Spacer(minLength: 0)
                            JarvisIconButton(
                                title: copy(.clearDate),
                                systemImage: "xmark.circle",
                                identifier: "today.log.date.clear"
                            ) { date = nil; resetStatus() }
                        }
                    } else {
                        HStack {
                            Text(copy(.dateRequired)).foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                            JarvisIconButton(
                                title: copy(.setDate),
                                systemImage: "calendar.badge.plus",
                                identifier: "today.log.date.set"
                            ) { date = model.now; resetStatus() }
                        }
                    }
                }
                switch kind {
                case .workout:
                    Section(copy(.sessionTypeGroup)) {
                        ForEach(JarvisGymSessionType.allCases) { option in
                            choiceRow(
                                title: option.title(language: language),
                                isSelected: session == option,
                                identifier: "today.workout.session.\(option.rawValue)"
                            ) { session = option }
                        }
                    }
                case .lift:
                    Section(copy(.liftType)) {
                        ForEach(JarvisGymLiftType.allCases) { option in
                            choiceRow(
                                title: option.title(language: language),
                                isSelected: liftType == option,
                                identifier: "today.lift.type.\(option.rawValue)"
                            ) { liftType = option }
                        }
                    }
                    Section {
                        TextField("kg", text: $weight)
                            .keyboardType(.decimalPad)
                            .accessibilityLabel("kg")
                            .accessibilityIdentifier("today.lift.weight")
                        TextField(copy(.reps), text: $reps)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("today.lift.reps")
                        TextField(copy(.sets), text: $sets)
                            .keyboardType(.numberPad)
                            .accessibilityIdentifier("today.lift.sets")
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
                        .accessibilityIdentifier("today.log.status")
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
        .accessibilityIdentifier("\(prefix).sheet")
    }

    private func choiceRow(
        title: String, isSelected: Bool, identifier: String, action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
            resetStatus()
        } label: {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer(minLength: 8)
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(JarvisDesignTokens.primaryAccent)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
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
        let target = kind == .workout ? session : liftType?.session
        guard let target else { return }
        status = .saving
        do {
            try await model.saveGymLog(
                session: target, lift: kind == .lift ? parsedLift : nil, on: date
            )
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
