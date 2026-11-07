import JarvisCore
import SwiftUI

/// The one composer, used by Chat and Home: a text field above one row (a leading control, the live dictation line
/// while listening, then the trailing actions) inside the glass surface with the animated rim. Chat and Home differ
/// only in what they put in `header`, `leading` and `actions`, and in the space around it.
struct JarvisComposerBar<Header: View, Leading: View, Actions: View>: View {
    let placeholder: String
    @Binding var draft: ComposerDraft
    let isFocused: FocusState<Bool>.Binding
    let inputIdentifier: String
    let inputHint: String
    let isInputDisabled: Bool
    let rimState: JarvisRimState
    let isRimAnimated: Bool
    let waveformLevels: [Float]?
    let onSubmit: () -> Void
    let header: Header
    let leading: Leading
    let actions: Actions

    init(
        placeholder: String,
        draft: Binding<ComposerDraft>,
        isFocused: FocusState<Bool>.Binding,
        inputIdentifier: String,
        inputHint: String = "",
        isInputDisabled: Bool = false,
        rimState: JarvisRimState,
        isRimAnimated: Bool,
        waveformLevels: [Float]? = nil,
        onSubmit: @escaping () -> Void,
        @ViewBuilder header: () -> Header,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder actions: () -> Actions
    ) {
        self.placeholder = placeholder
        _draft = draft
        self.isFocused = isFocused
        self.inputIdentifier = inputIdentifier
        self.inputHint = inputHint
        self.isInputDisabled = isInputDisabled
        self.rimState = rimState
        self.isRimAnimated = isRimAnimated
        self.waveformLevels = waveformLevels
        self.onSubmit = onSubmit
        self.header = header()
        self.leading = leading()
        self.actions = actions()
    }

    var body: some View {
        let revision = draft.revision
        VStack(spacing: 0) {
            header
            TextField(placeholder, text: Binding(
                get: { draft.text },
                set: { draft.edit($0, revision: revision) }
            ), axis: .vertical)
                .id(revision)
                .font(.body)
                .lineLimit(1...JarvisDesignTokens.chatComposerMaximumLines)
                .focused(isFocused)
                .submitLabel(.send)
                .onSubmit(onSubmit)
                .disabled(isInputDisabled)
                .padding(.horizontal, JarvisDesignTokens.chatComposerTextInset)
                .padding(.top, JarvisDesignTokens.chatComposerTextInset)
                .padding(.bottom, JarvisDesignTokens.chatComposerSpacing / 2)
                .accessibilityLabel(placeholder)
                .accessibilityIdentifier(inputIdentifier)
                .accessibilityHint(inputHint)

            HStack(spacing: 0) {
                leading
                if let waveformLevels {
                    JarvisWaveform(levels: waveformLevels)
                        .padding(.horizontal, JarvisDesignTokens.chatComposerSpacing)
                        .accessibilityIdentifier("\(inputIdentifier).waveform")
                } else {
                    Spacer(minLength: 0)
                }
                actions
            }
        }
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
        .padding(.horizontal, JarvisDesignTokens.chatHorizontalInset)
        .padding(.bottom, JarvisDesignTokens.chatVerticalInset)
    }
}
