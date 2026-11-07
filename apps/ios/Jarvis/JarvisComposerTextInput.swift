import JarvisCore
import SwiftUI
import UIKit

/// One native editor survives submission so clearing a draft does not dismiss the keyboard.
/// Return submits; a Return that confirms marked text remains an input-method operation.
struct JarvisComposerTextInput: UIViewRepresentable {
    @Binding var draft: ComposerDraft
    let isFocused: Binding<Bool>
    let placeholder: String
    let identifier: String
    let hint: String
    let isDisabled: Bool
    let onSubmit: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> JarvisComposerTextView {
        let view = JarvisComposerTextView()
        view.delegate = context.coordinator
        view.onWindowReady = { [weak coordinator = context.coordinator] view in
            coordinator?.scheduleFocusUpdate(for: view)
        }
        return view
    }

    func updateUIView(_ view: JarvisComposerTextView, context: Context) {
        _ = dynamicTypeSize
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.isUpdatingView = true
        defer { coordinator.isUpdatingView = false }

        let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: view.traitCollection)
        if view.font != font { view.font = font }
        view.textColor = .label
        view.tintColor = UIColor(JarvisDesignTokens.primaryAccent)
        view.placeholderLabel.text = placeholder
        view.placeholderLabel.font = view.font
        view.accessibilityLabel = placeholder
        view.accessibilityIdentifier = identifier
        view.accessibilityHint = hint
        if view.isEditable == isDisabled { view.isEditable = !isDisabled }
        if view.isSelectable == isDisabled { view.isSelectable = !isDisabled }
        coordinator.reconcileText(in: view)
        coordinator.scheduleFocusUpdate(for: view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: JarvisComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        return uiView.composerSize(for: width)
    }

    static func dismantleUIView(_ view: JarvisComposerTextView, coordinator: Coordinator) {
        coordinator.isDetached = true
        view.onWindowReady = nil
        view.delegate = nil
        view.resignFirstResponder()
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: JarvisComposerTextInput
        var isUpdatingView = false
        var isDetached = false
        private var editorRevision: UUID
        private var isReconcilingText = false
        private var focusRequest = 0

        init(parent: JarvisComposerTextInput) {
            self.parent = parent
            editorRevision = parent.draft.revision
        }

        func reconcileText(in view: JarvisComposerTextView) {
            let current = parent.draft
            let submitted = editorRevision != current.revision
            guard submitted || (view.text != current.text && view.markedTextRange == nil) else {
                view.refreshPlaceholderAndSize()
                return
            }

            isReconcilingText = true
            defer { isReconcilingText = false }
            editorRevision = current.revision
            let selection = view.selectedRange
            let wasAtEnd = selection.length == 0 && selection.location == (view.text as NSString).length
            if submitted {
                // A deliberate submission ends the old composition and undo session.
                // No resign/become cycle is needed to clear the same first responder.
                view.unmarkText()
                view.undoManager?.removeAllActions()
            }
            view.text = current.text
            let length = (current.text as NSString).length
            if submitted || wasAtEnd {
                view.selectedRange = NSRange(location: length, length: 0)
            } else {
                let start = min(max(0, selection.location), length)
                view.selectedRange = NSRange(location: start, length: min(selection.length, length - start))
            }
            view.refreshPlaceholderAndSize()
        }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard let view = textView as? JarvisComposerTextView,
                  !isDetached, !isUpdatingView, !isReconcilingText, !parent.isDisabled else { return false }
            // A callback queued before the button consumed the draft belongs to the old editor.
            guard editorRevision == parent.draft.revision else {
                reconcileText(in: view)
                return false
            }
            let length = (view.text as NSString).length
            guard range.location >= 0, range.length >= 0,
                  range.location <= length, range.length <= length - range.location else { return false }
            if text == "\n", !view.isPasting, view.markedTextRange == nil {
                parent.onSubmit()
                // Read through the live binding, not the pre-submit representable value.
                reconcileText(in: view)
                return false
            }
            return true
        }

        func textViewDidChange(_ textView: UITextView) {
            guard let view = textView as? JarvisComposerTextView,
                  !isDetached, !isUpdatingView, !isReconcilingText else { return }
            guard editorRevision == parent.draft.revision, !parent.isDisabled else {
                reconcileText(in: view)
                return
            }
            parent.draft.edit(view.text, revision: editorRevision)
            view.refreshPlaceholderAndSize()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            guard !isDetached, !isUpdatingView, !parent.isFocused.wrappedValue else { return }
            parent.isFocused.wrappedValue = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            guard !isDetached, !isUpdatingView, parent.isFocused.wrappedValue else { return }
            parent.isFocused.wrappedValue = false
        }

        func scheduleFocusUpdate(for view: JarvisComposerTextView) {
            focusRequest &+= 1
            let request = focusRequest
            // UIKit delegate callbacks must not write SwiftUI focus state during updateUIView.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, !self.isDetached, request == self.focusRequest else { return }
                let shouldFocus = self.parent.isFocused.wrappedValue && !self.parent.isDisabled
                if self.parent.isDisabled, self.parent.isFocused.wrappedValue {
                    self.parent.isFocused.wrappedValue = false
                }
                if shouldFocus {
                    guard view.window != nil, !view.isFirstResponder else { return }
                    view.becomeFirstResponder()
                } else if view.isFirstResponder {
                    view.resignFirstResponder()
                }
            }
        }
    }
}

/// UIKit owns selection, composition, dictation and scrolling inside the five-line editor.
final class JarvisComposerTextView: UITextView {
    let placeholderLabel = UILabel()
    var onWindowReady: ((JarvisComposerTextView) -> Void)?
    private(set) var isPasting = false

    init() {
        super.init(frame: .zero, textContainer: nil)
        backgroundColor = .clear
        isScrollEnabled = false
        showsVerticalScrollIndicator = false
        textContainerInset = .zero
        textContainer.lineFragmentPadding = 0
        contentInsetAdjustmentBehavior = .never
        adjustsFontForContentSizeCategory = true
        returnKeyType = .send
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.adjustsFontForContentSizeCategory = true
        placeholderLabel.isUserInteractionEnabled = false
        placeholderLabel.isAccessibilityElement = false
        placeholderLabel.accessibilityElementsHidden = true
        addSubview(placeholderLabel)
    }

    required init?(coder: NSCoder) { return nil }

    override func paste(_ sender: Any?) {
        // A pasted newline is content, even when it is the entire pasteboard string.
        isPasting = true
        defer { isPasting = false }
        super.paste(sender)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { onWindowReady?(self) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        placeholderLabel.frame = CGRect(x: 0, y: 0, width: bounds.width, height: minimumHeight)
        guard bounds.width > 0 else { return }
        let needsScrolling = naturalHeight(for: bounds.width) > maximumHeight
        if isScrollEnabled != needsScrolling { isScrollEnabled = needsScrolling }
    }

    func refreshPlaceholderAndSize() {
        placeholderLabel.isHidden = !text.isEmpty
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    func composerSize(for width: CGFloat) -> CGSize {
        CGSize(width: width, height: min(maximumHeight, max(minimumHeight, naturalHeight(for: width))))
    }

    private var minimumHeight: CGFloat { ceil((font ?? UIFont.preferredFont(forTextStyle: .body)).lineHeight) }
    private var maximumHeight: CGFloat {
        ceil((font ?? UIFont.preferredFont(forTextStyle: .body)).lineHeight * CGFloat(JarvisDesignTokens.chatComposerMaximumLines))
    }

    private func naturalHeight(for width: CGFloat) -> CGFloat {
        ceil(super.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
    }
}
