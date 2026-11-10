import SwiftUI
import WatchKit

/// Compact form row; native typing opens in its own editor instead of nesting field chrome in a List.
struct WatchTextInput: View {
    var title: String
    @Binding var text: String
    var multiline = false
    var alignment: VerticalAlignment = .center
    @State private var editing = false
    @State private var failure: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: alignment, spacing: 6) {
                Button { editing = true } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        if !text.isEmpty { Text(title).font(.caption).foregroundStyle(.secondary) }
                        Text(text.isEmpty ? title : text).font(.body).lineLimit(multiline ? nil : 2)
                            .frame(maxWidth: .infinity, minHeight: multiline ? 90 : 38, alignment: .topLeading)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(title)
                    .accessibilityValue(text.isEmpty ? "Empty" : text)
                WatchDictateButton(title: title, text: $text, failure: $failure)
            }
            if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
        }
        .sheet(isPresented: $editing) { NavigationStack { WatchTextEditor(title: title, text: $text, multiline: multiline) } }
    }
}

struct WatchTextEditor: View {
    var title: String
    @Binding var text: String
    var multiline = false
    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                TextField(title, text: $text, axis: multiline ? .vertical : .horizontal)
                    .lineLimit(multiline ? 3...8 : 1...1)
                    .font(.body).focused($focused).accessibilityLabel(title)
                WatchDictateButton(title: title, text: $text, failure: $failure)
            }
            if let failure { Text(failure).font(.caption) }
            Button("Done") { dismiss() }
        }.navigationTitle(title)
            .task { await Task.yield(); focused = true }
    }
}

private struct WatchDictateButton: View {
    var title: String
    @Binding var text: String
    @Binding var failure: String?
    @State private var presenting = false
    var body: some View {
        Button { beginDictation() } label: {
            Image(systemName: "mic.fill").frame(width: 32, height: 38)
        }.buttonStyle(.plain).foregroundStyle(WatchStyle.amber)
            .disabled(presenting).accessibilityLabel("Dictate " + title)
    }
    private func beginDictation() {
        guard !presenting, let controller = WKExtension.shared().visibleInterfaceController else {
            failure = "Tap the field to type or dictate."; return
        }
        presenting = true; failure = nil
        controller.presentTextInputController(withSuggestions: nil, allowedInputMode: .plain) { values in
            Task { @MainActor in
                presenting = false
                guard let value = values?.first as? String, !value.isEmpty else { return }
                text = text.isEmpty ? value : text + " " + value
            }
        }
    }
}

struct WatchCountPicker: View {
    var title: String
    @Binding var value: Int
    var range: ClosedRange<Int> = 1...100
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 8) {
            Picker(title, selection: $value) {
                ForEach(range, id: \.self) { number in
                    Text(number.formatted()).font(.title2).tag(number)
                }
            }.pickerStyle(.wheel).labelsHidden().frame(height: 110)
                .accessibilityLabel(title)
            Button("Done") { dismiss() }
        }.navigationTitle(title)
            .watchCaptureReady("new-lift")
    }
}

struct WatchWeightEditor: View {
    @Binding var kilograms: Double
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 8) {
            TextField("Weight (kg)", value: $kilograms, format: .number)
                .font(.body).focused($focused).accessibilityLabel("Weight in kilograms")
            Button("Done") { dismiss() }
        }.navigationTitle("Weight (kg)")
            .task { await Task.yield(); focused = true }
    }
}

struct WatchAddButton: View {
    var title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) { Image(systemName: "plus").font(.title3).frame(width: 44, height: 44) }
            .buttonStyle(.plain).foregroundStyle(WatchStyle.amber).accessibilityLabel(title)
    }
}

struct WatchChoiceBar<Value: Hashable>: View {
    let choices: [(Value, String)]
    @Binding var selection: Value
    var body: some View {
        HStack(spacing: 4) {
            ForEach(choices.indices, id: \.self) { index in
                let (value, title) = choices[index]
                Button { selection = value } label: {
                    Text(title).font(.system(.body, design: .rounded, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(selection == value ? WatchStyle.surface : .clear)
                        }
                }.buttonStyle(.plain)
                    .foregroundStyle(selection == value ? WatchStyle.amber : WatchStyle.stone)
                    .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
    }
}
