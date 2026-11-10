import SwiftUI
import WatchKit

/// Native typing/Scribble plus an explicit system dictation entry point for every free-text field.
struct WatchTextInput: View {
    var title: String
    @Binding var text: String
    @State private var presenting = false
    @State private var failure: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                TextField(title, text: $text).font(.body).accessibilityLabel(title)
                Button {
                    beginDictation()
                } label: {
                    Image(systemName: "mic.fill").frame(width: 32, height: 38)
                }.buttonStyle(.plain).foregroundStyle(WatchStyle.amber)
                    .disabled(presenting).accessibilityLabel("Dictate " + title)
            }
            if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
        }
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
    }
}

struct WatchAddButton: View {
    var title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) { Image(systemName: "plus").frame(minWidth: 32, minHeight: 32) }
            .accessibilityLabel(title)
    }
}
