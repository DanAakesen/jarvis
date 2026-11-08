import SwiftUI
import UIKit

/// A single native selection range spans the whole reply, including paragraphs and lists.
struct JarvisSelectableReply: UIViewRepresentable {
    let text: String
    let identifier: String
    var onTap: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        return view
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onTap: (() -> Void)?
        private var touchBeganAt: TimeInterval = 0
        @objc func tapped() {
            // A long press belongs to UIKit text selection. Do not reflow the
            // reply by revealing its timestamp when the selection touch ends.
            guard ProcessInfo.processInfo.systemUptime - touchBeganAt < 0.35 else { return }
            onTap?()
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            otherGestureRecognizer is UILongPressGestureRecognizer
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            touchBeganAt = touch.timestamp
            guard let view = gestureRecognizer.view as? UITextView else { return false }
            if view.selectedRange.length > 0 { return false }
            let point = touch.location(in: view)
            if let position = view.closestPosition(to: point) {
                let index = view.offset(from: view.beginningOfDocument, to: position)
                if index < view.attributedText.length,
                   view.attributedText.attribute(.link, at: index, effectiveRange: nil) != nil { return false }
            }
            return true
        }
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.onTap = onTap
        _ = dynamicTypeSize
        view.accessibilityIdentifier = identifier
        let value = attributedText(traits: view.traitCollection)
        // Activity updates must not reset the owner's selection.
        if !view.attributedText.isEqual(to: value) { view.attributedText = value }
        view.linkTextAttributes = [.foregroundColor: UIColor(JarvisDesignTokens.primaryAccent)]
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? JarvisDesignTokens.chatMessageMaximumWidth
        return CGSize(width: width, height: ceil(uiView.sizeThatFits(
            CGSize(width: width, height: .greatestFiniteMagnitude)
        ).height))
    }

    private func attributedText(traits: UITraitCollection) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        for (index, block) in ChatMarkdownBlock.parse(text).enumerated() {
            if index > 0 { result.append(NSAttributedString(string: "\n")) }
            let content: String
            let style: UIFont.TextStyle
            let prefix: String
            switch block {
            case .heading(let level, let value):
                content = value
                style = level == 1 ? .title2 : (level == 2 ? .title3 : .headline)
                prefix = ""
            case .paragraph(let value):
                content = value
                style = .body
                prefix = ""
            case .listItem(let marker, let value):
                content = value
                style = .body
                prefix = marker + "  "
            }
            let font = UIFont.preferredFont(forTextStyle: style, compatibleWith: traits)
            let paragraph = NSMutableParagraphStyle()
            paragraph.paragraphSpacing = JarvisDesignTokens.chatMessageSpacing
            paragraph.headIndent = (prefix as NSString).size(withAttributes: [.font: font]).width
            let segment = NSMutableAttributedString(string: prefix, attributes: [.font: font, .foregroundColor: UIColor.label])
            let attributed = (try? AttributedString(markdown: content)) ?? AttributedString(content)
            for run in attributed.runs {
                var runFont = font
                var fontTraits: UIFontDescriptor.SymbolicTraits = []
                if run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true || style != .body { fontTraits.insert(.traitBold) }
                if run.inlinePresentationIntent?.contains(.emphasized) == true { fontTraits.insert(.traitItalic) }
                if let descriptor = font.fontDescriptor.withSymbolicTraits(fontTraits) { runFont = UIFont(descriptor: descriptor, size: font.pointSize) }
                if run.inlinePresentationIntent?.contains(.code) == true { runFont = .monospacedSystemFont(ofSize: font.pointSize, weight: .regular) }
                var attributes: [NSAttributedString.Key: Any] = [.font: runFont, .foregroundColor: UIColor.label]
                if let link = run.link { attributes[.link] = link }
                if run.inlinePresentationIntent?.contains(.strikethrough) == true { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
                segment.append(NSAttributedString(string: String(attributed[run.range].characters), attributes: attributes))
            }
            segment.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: segment.length))
            result.append(segment)
        }
        return result
    }
}
