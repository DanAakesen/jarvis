import JarvisCore
import SwiftUI

/// Chat folds the editor and controls into one row between edits.
struct JarvisComposerBar<Header: View, Leading: View, Actions: View, CompactAccessory: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let placeholder: String
    @Binding var draft: ComposerDraft
    let isFocused: Binding<Bool>
    let inputIdentifier: String
    let inputHint: String
    let isInputDisabled: Bool
    let collapsesWhenUnfocused: Bool
    let rimState: JarvisRimState
    let isRimAnimated: Bool
    let waveformLevels: [Float]?
    let onSubmit: () -> Void
    let header: Header
    let leading: Leading
    let actions: Actions
    let compactAccessory: CompactAccessory

    init(
        placeholder: String,
        draft: Binding<ComposerDraft>,
        isFocused: Binding<Bool>,
        inputIdentifier: String,
        inputHint: String = "",
        isInputDisabled: Bool = false,
        collapsesWhenUnfocused: Bool = false,
        rimState: JarvisRimState,
        isRimAnimated: Bool,
        waveformLevels: [Float]? = nil,
        onSubmit: @escaping () -> Void,
        @ViewBuilder header: () -> Header,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder compactAccessory: () -> CompactAccessory = { EmptyView() }
    ) {
        self.placeholder = placeholder
        _draft = draft
        self.isFocused = isFocused
        self.inputIdentifier = inputIdentifier
        self.inputHint = inputHint
        self.isInputDisabled = isInputDisabled
        self.collapsesWhenUnfocused = collapsesWhenUnfocused
        self.rimState = rimState
        self.isRimAnimated = isRimAnimated
        self.waveformLevels = waveformLevels
        self.onSubmit = onSubmit
        self.header = header()
        self.leading = leading()
        self.actions = actions()
        self.compactAccessory = compactAccessory()
    }

    var body: some View {
        let compact = collapsesWhenUnfocused && !isFocused.wrappedValue && waveformLevels == nil
        HStack(spacing: JarvisDesignTokens.chatComposerSpacing) {
            composer(compact: compact)
            if compact { compactAccessory }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: compact)
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
        .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
    }

    private func composer(compact: Bool) -> some View {
        // AnyLayout repositions the same native editor, preserving first responder and selection.
        let layout = compact ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
        return VStack(spacing: 0) {
            header
            layout {
                HStack(spacing: 0) {
                    if compact { leading }
                    JarvisComposerTextInput(
                        draft: $draft,
                        isFocused: isFocused,
                        placeholder: placeholder,
                        identifier: inputIdentifier,
                        hint: inputHint,
                        isDisabled: isInputDisabled,
                        isCompact: compact,
                        onSubmit: onSubmit
                    )
                    .padding(.horizontal, compact ? JarvisDesignTokens.chatComposerSpacing / 2 : JarvisDesignTokens.chatComposerTextInset)
                    .padding(.top, compact ? 0 : JarvisDesignTokens.chatComposerTextInset)
                    .padding(.bottom, compact ? 0 : JarvisDesignTokens.chatComposerSpacing / 2)
                    .frame(maxWidth: .infinity)
                }
                HStack(spacing: 0) {
                    if !compact {
                        leading
                        if let waveformLevels {
                            JarvisWaveform(levels: waveformLevels)
                                .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing)
                                .accessibilityIdentifier("\(inputIdentifier).waveform")
                        } else {
                            Spacer(minLength: 0)
                        }
                    }
                    actions
                }
            }
        }
        .padding(.top, compact ? JarvisDesignTokens.chatComposerSpacing / 2 : 0)
        .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing / 2)
        .padding(.bottom, JarvisDesignTokens.chatComposerSpacing / 2)
        .background {
            Color.clear
                .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceRadius)
                .jarvisRim(cornerRadius: JarvisDesignTokens.surfaceRadius, state: rimState, isAnimated: isRimAnimated)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .jarvisCarryOver(.composer)
    }
}
