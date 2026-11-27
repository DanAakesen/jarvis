import JarvisCore
import SwiftUI
import UIKit

/// Handles Return at the keyboard boundary to leave pasted Markdown and toolbar edits intact.
final class JarvisNoteTextView: UITextView {
    private var pasting = false
    var lastSource: String?
    var lastSelectedLines: NSRange?
    var lastSizeCategory: UIContentSizeCategory?
    var isFormatting = false

    override func paste(_ sender: Any?) {
        pasting = true
        defer { pasting = false }
        super.paste(sender)
    }

    override func insertText(_ input: String) {
        guard input == "\n", !pasting, markedTextRange == nil,
              let edit = JarvisMarkdownList.returnEdit(in: text, selection: selectedRange) else {
            super.insertText(input)
            return
        }
        if edit.replacement.isEmpty {
            selectedRange = edit.range
            super.deleteBackward()
        } else {
            super.insertText(edit.replacement)
        }
    }
}

struct JarvisNoteBodyEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange?
    @Binding var focused: Bool
    let label: String
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> JarvisNoteTextView {
        let view = JarvisNoteTextView(usingTextLayoutManager: false)
        view.layoutManager.delegate = view
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.isScrollEnabled = false
        view.accessibilityIdentifier = "editor.body"
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: JarvisNoteTextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.updating = true
        defer { coordinator.updating = false }
        view.accessibilityLabel = label
        view.isEditable = isEnabled
        view.tintColor = UIColor(JarvisDesignTokens.primaryAccent)
        if view.markedTextRange == nil {
            if view.text != text { view.text = text }
            if let selection, view.selectedRange != selection, Range(selection, in: text) != nil {
                view.selectedRange = selection
            }
            view.formatDocument()
        }
        if view.isFirstResponder != focused {
            DispatchQueue.main.async { [weak view] in
                guard let view, view.window != nil, view.isFirstResponder != coordinator.parent.focused else { return }
                if coordinator.parent.focused { view.becomeFirstResponder() } else { view.resignFirstResponder() }
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: JarvisNoteTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: JarvisNoteBodyEditor
        var updating = false

        init(_ parent: JarvisNoteBodyEditor) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            guard !updating, (view as? JarvisNoteTextView)?.isFormatting != true else { return }
            parent.text = view.text
            parent.selection = view.selectedRange
            view.invalidateIntrinsicContentSize()
        }

        func textViewDidChangeSelection(_ view: UITextView) {
            if !updating, view.isFirstResponder, (view as? JarvisNoteTextView)?.isFormatting != true {
                parent.selection = view.selectedRange
            }
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            parent.focused = true
            (view as? JarvisNoteTextView)?.formatDocument()
        }

        func textViewDidEndEditing(_ view: UITextView) {
            parent.focused = false
            (view as? JarvisNoteTextView)?.formatDocument()
        }
    }
}
