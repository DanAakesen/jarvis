import CoreText
import JarvisCore
import SwiftUI
import UIKit

/// Layout-only Markdown decoration. The text storage's characters and all UIKit selection
/// offsets remain the original Markdown, including while copying, undoing or using the toolbar.
extension JarvisNoteTextView: NSLayoutManagerDelegate {
    private static let displayedGlyph = NSAttributedString.Key("JarvisNoteDisplayedGlyph")

    func formatDocument() {
        guard markedTextRange == nil, !isFormatting else { return }
        let source = textStorage.string
        let ns = source as NSString
        let selectedLines = isFirstResponder && selectedRange.location != NSNotFound
            ? ns.lineRange(for: selectedRange) : nil
        let sizeCategory = traitCollection.preferredContentSizeCategory
        guard source != lastSource || selectedLines != lastSelectedLines || sizeCategory != lastSizeCategory else { return }
        isFormatting = true
        defer { isFormatting = false }
        lastSource = source
        lastSelectedLines = selectedLines
        lastSizeCategory = sizeCategory

        let baseFont = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection)
        let base: [NSAttributedString.Key: Any] = [.font: baseFont, .foregroundColor: UIColor.label]
        let whole = NSRange(location: 0, length: ns.length)
        textStorage.beginEditing()
        textStorage.setAttributes(base, range: whole)
        let document = JarvisNoteDocument(source)
        var start = document.metadata.utf16.count
        for block in document.blocks {
            let prefix = NSRange(location: start, length: block.prefix.utf16.count)
            let body = NSRange(location: NSMaxRange(prefix), length: block.text.utf16.count)
            let line = NSRange(location: start, length: prefix.length + body.length)
            start = NSMaxRange(line) + block.ending.utf16.count
            guard line.length > 0 else { continue }
            let showMarkup = selectedLines.map { NSIntersectionRange($0, line).length > 0 } ?? false
            if block.isCode {
                applyCode(to: line, font: baseFont)
                let trimmed = block.text.trimmingCharacters(in: .whitespaces)
                if !showMarkup, trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                    hide(line)
                }
                continue
            }
            if block.headingLevel > 0 {
                let styles: [UIFont.TextStyle] = [.title1, .title2, .title3, .headline, .subheadline, .body]
                let font = UIFont.preferredFont(forTextStyle: styles[block.headingLevel - 1], compatibleWith: traitCollection)
                textStorage.addAttribute(.font, value: font, range: line)
                applyTrait(.traitBold, to: line)
            } else if block.isChecked {
                textStorage.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue,
                                           .foregroundColor: UIColor.secondaryLabel], range: body)
            } else if block.prefix.trimmingCharacters(in: .whitespaces) == ">" {
                applyTrait(.traitItalic, to: body)
            }
            if !showMarkup, prefix.length > 0 {
                formatPrefix(block, range: prefix)
            }
            for span in JarvisNoteInlineSpan.parse(block.text) {
                let inner = NSRange(location: body.location + span.content.location, length: span.content.length)
                switch span.style {
                case .bold: applyTrait(.traitBold, to: inner)
                case .italic: applyTrait(.traitItalic, to: inner)
                case .highlight: textStorage.addAttribute(.backgroundColor, value: UIColor(JarvisDesignTokens.notesHighlight), range: inner)
                case .code: applyCode(to: inner, font: baseFont)
                case .link: textStorage.addAttribute(.foregroundColor, value: tintColor ?? UIColor.link, range: inner)
                }
                if !showMarkup {
                    let left = body.location + span.range.location
                    let end = body.location + NSMaxRange(span.range)
                    hide(NSRange(location: left, length: inner.location - left))
                    hide(NSRange(location: NSMaxRange(inner), length: end - NSMaxRange(inner)))
                }
            }
        }
        textStorage.endEditing()
        layoutManager.invalidateGlyphs(forCharacterRange: whole, changeInLength: 0, actualCharacterRange: nil)
        typingAttributes = base
        invalidateIntrinsicContentSize()
    }

    private func formatPrefix(_ block: JarvisNoteDocument.Block, range: NSRange) {
        let token = block.prefix.trimmingCharacters(in: .whitespaces)
        if block.isChecklist || (block.isBullet && token.first?.isNumber == false) {
            // Keep indentation and the final space. Use the marker's glyph slot for the visual bullet.
            let leading = block.prefix.prefix(while: { $0.isWhitespace }).utf16.count
            let marker = range.location + leading
            let symbol: UInt16 = block.isChecklist ? (block.isChecked ? 0x2611 : 0x2610) : 0x2022
            let markerRange = NSRange(location: marker, length: 1)
            let character = String(decoding: [symbol], as: UTF16.self)
            let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection)
            let symbolFont = CTFontCreateForString(font as CTFont, character as CFString, CFRange(location: 0, length: 1))
            textStorage.addAttributes([.font: symbolFont as UIFont, Self.displayedGlyph: Int(symbol)], range: markerRange)
            hide(NSRange(location: marker + 1, length: max(0, NSMaxRange(range) - marker - 2)))
        } else if !block.isBullet {
            hide(range)
        }
    }

    private func applyTrait(_ trait: UIFontDescriptor.SymbolicTraits, to range: NSRange) {
        textStorage.enumerateAttribute(.font, in: range) { value, run, _ in
            guard let font = value as? UIFont,
                  let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(trait)) else { return }
            textStorage.addAttribute(.font, value: UIFont(descriptor: descriptor, size: font.pointSize), range: run)
        }
    }

    private func applyCode(to range: NSRange, font: UIFont) {
        textStorage.addAttributes([.font: UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular),
                                   .backgroundColor: UIColor.secondarySystemFill], range: range)
    }

    private func hide(_ range: NSRange) {
        if range.length > 0 { textStorage.addAttribute(Self.displayedGlyph, value: 0, range: range) }
    }

    func layoutManager(_ layoutManager: NSLayoutManager, shouldGenerateGlyphs glyphs: UnsafePointer<CGGlyph>,
                       properties: UnsafePointer<NSLayoutManager.GlyphProperty>, characterIndexes: UnsafePointer<Int>,
                       font: UIFont, forGlyphRange range: NSRange) -> Int {
        var replacements: [CGGlyph] = []
        var flags: [NSLayoutManager.GlyphProperty] = []
        for i in 0..<range.length {
            guard let value = textStorage.attribute(Self.displayedGlyph, at: characterIndexes[i], effectiveRange: nil) as? Int else { continue }
            if replacements.isEmpty {
                replacements = Array(UnsafeBufferPointer(start: glyphs, count: range.length))
                flags = Array(UnsafeBufferPointer(start: properties, count: range.length))
            }
            if value == 0 {
                flags[i].insert(.null)
            } else {
                var character = UniChar(value)
                var replacement: CGGlyph = 0
                if CTFontGetGlyphsForCharacters(font as CTFont, &character, &replacement, 1) {
                    replacements[i] = replacement
                }
            }
        }
        guard !replacements.isEmpty else { return 0 }
        layoutManager.setGlyphs(replacements, properties: flags, characterIndexes: characterIndexes, font: font, forGlyphRange: range)
        return range.length
    }
}
