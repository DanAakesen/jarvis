import SwiftUI

/// Settings keep their names visible after values are entered. Larger text and long
/// labels stack without clipping; ordinary compact values align with Health goals.
struct JarvisSettingsTextField: View {
    let title: String
    @Binding var text: String
    let identifier: String
    var keyboard: UIKeyboardType = .default
    var multiline = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var numberWidth: CGFloat = 100

    private var numeric: Bool { keyboard == .numberPad || keyboard == .decimalPad }

    var body: some View {
        Group {
            if multiline || dynamicTypeSize.isAccessibilitySize {
                stacked
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.chatMessageSpacing) {
                        label.fixedSize()
                        Spacer(minLength: 0)
                        input(alignment: .trailing)
                            .frame(minWidth: numeric ? numberWidth : 120,
                                   maxWidth: numeric ? numberWidth : .infinity)
                    }
                    stacked
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var label: some View {
        Text(title)
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("\(identifier).label")
    }

    private var stacked: some View {
        VStack(alignment: .leading, spacing: JarvisDesignTokens.chatMessageSpacing) {
            label
            input(alignment: multiline ? .leading : .trailing)
        }
    }

    private func input(alignment: TextAlignment) -> some View {
        TextField(title, text: $text, prompt: Text(""), axis: multiline ? .vertical : .horizontal)
            .lineLimit(multiline ? 4...8 : 1...1)
            .keyboardType(keyboard)
            .textInputAutocapitalization(multiline ? .sentences : .never)
            .autocorrectionDisabled(!multiline)
            .multilineTextAlignment(alignment)
            .accessibilityLabel(title)
            .accessibilityIdentifier(identifier)
    }
}
