import SwiftUI

/// The shared control layer. Screens use these instead of building their own button chrome:
/// icon-only, SF Symbols, 44 pt hit targets and the system glass or prominent styles.
/// HIG: Buttons, Toolbars, Sheets, Toggles, Pickers. API: ButtonStyle.glass, ToolbarContent, Label, LabelStyle.iconOnly.

/// The one glass surface for anything that floats over content: Now bar, composer, pills, search, floating buttons.
/// Uses Apple's glass (`glassEffect`, iOS 26, the app's deployment target) and falls back to a solid system
/// material when Reduce Transparency is on. Toolbar items get the same glass from the system toolbar, so the
/// navigation bar itself stays transparent while each control keeps its own glass capsule or circle.
/// API: View.glassEffect(_:in:), Glass, Shape, AccessibilityEnvironment reduceTransparency.
struct JarvisGlassSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var cornerRadius: CGFloat?

    private var shape: AnyShape {
        if let cornerRadius { AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)) } else { AnyShape(Capsule()) }
    }

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(.regularMaterial, in: shape)
        } else {
            content.glassEffect(.regular, in: shape)
        }
    }
}

extension View {
    /// Glass behind a floating control. Pass a radius for a rounded rectangle, or none for a capsule.
    func jarvisGlassSurface(cornerRadius: CGFloat? = nil) -> some View {
        modifier(JarvisGlassSurface(cornerRadius: cornerRadius))
    }
}

/// Icon-only glass button for toolbars and floating controls.
struct JarvisIconButton: View {
    let title: String
    let systemImage: String
    var identifier: String?
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .frame(
                    minWidth: JarvisDesignTokens.chatMinimumTapTarget,
                    minHeight: JarvisDesignTokens.chatMinimumTapTarget
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.glass)
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// Check mark that confirms a sheet. Shows a progress view while the work runs.
struct JarvisSheetConfirmButton: View {
    let title: String
    var isWorking = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if isWorking {
                ProgressView()
            } else {
                Label(title, systemImage: "checkmark").labelStyle(.iconOnly)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isDisabled || isWorking)
        .accessibilityLabel(title)
        .accessibilityIdentifier("sheet.confirm")
    }
}

/// X that closes a sheet. It sits on the right, within thumb reach.
struct JarvisSheetCloseButton: View {
    let title: String
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "xmark").labelStyle(.iconOnly)
        }
        .disabled(isDisabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier("sheet.cancel")
    }
}

/// Toolbar content every sheet shares: check mark to confirm, X to close, both icon-only and trailing.
struct JarvisSheetToolbar: ToolbarContent {
    let confirmTitle: String
    let closeTitle: String
    var isWorking = false
    var isConfirmDisabled = false
    let onConfirm: () -> Void
    let onClose: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            JarvisSheetConfirmButton(
                title: confirmTitle,
                isWorking: isWorking,
                isDisabled: isConfirmDisabled,
                action: onConfirm
            )
        }
        ToolbarItem(placement: .topBarTrailing) {
            JarvisSheetCloseButton(title: closeTitle, isDisabled: isWorking, action: onClose)
        }
    }
}

/// Floating capsule pill for legends and filters.
struct JarvisChip: View {
    let title: String
    var systemImage: String?
    var isSelected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage) }
                Text(title).lineLimit(1)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .frame(minHeight: JarvisDesignTokens.chatMinimumTapTarget)
            .contentShape(Capsule())
        }
        .buttonStyle(.glass)
        .tint(isSelected ? JarvisDesignTokens.primaryAccent : nil)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Filled circular action, for the composer's send button.
struct JarvisFilledCircleButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: JarvisDesignTokens.chatComposerIconSize - 4, weight: .bold))
                .frame(
                    width: JarvisDesignTokens.chatComposerSendDiameter,
                    height: JarvisDesignTokens.chatComposerSendDiameter
                )
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.circle)
        .tint(JarvisDesignTokens.primaryAccent)
        .foregroundStyle(JarvisDesignTokens.primaryAccentForeground)
        .frame(
            width: JarvisDesignTokens.chatMinimumTapTarget,
            height: JarvisDesignTokens.chatMinimumTapTarget
        )
    }
}
