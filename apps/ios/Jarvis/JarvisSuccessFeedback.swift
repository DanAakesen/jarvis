import SwiftUI
import UIKit

/// A confirmed write, never a pending or uncertain outcome.
struct JarvisSuccessConfirmation: Equatable {
    let id = UUID()
    let message: String
}

private struct JarvisSuccessFeedbackModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var confirmation: JarvisSuccessConfirmation?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let confirmation {
                    Label(confirmation.message, systemImage: "checkmark.circle.fill")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, JarvisDesignTokens.contentInset)
                        .padding(.vertical, JarvisDesignTokens.listRowVerticalInset)
                        .jarvisGlassSurface(cornerRadius: JarvisDesignTokens.surfaceCornerRadius)
                        .padding(.horizontal, JarvisDesignTokens.contentInset)
                        .padding(.top, JarvisDesignTokens.compactSpacing)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("action.success")
                        .allowsHitTesting(false)
                        .transition(reduceMotion ? .identity : .opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .animation(reduceMotion ? nil : .easeOut(duration: JarvisDesignTokens.filterAnimationDuration), value: confirmation?.id)
            .sensoryFeedback(.success, trigger: confirmation?.id) { _, new in new != nil }
            .onDisappear { confirmation = nil }
            .task(id: confirmation?.id) {
                guard let current = confirmation else { return }
                UIAccessibility.post(notification: .announcement, argument: current.message)
                do {
                    try await Task.sleep(for: .milliseconds(JarvisDesignTokens.openedFeedbackMilliseconds))
                } catch { return }
                guard !Task.isCancelled, confirmation?.id == current.id else { return }
                confirmation = nil
            }
    }
}

extension View {
    /// Repeated success replaces the current confirmation and cancels its expiry; it never blocks input.
    func jarvisSuccessFeedback(_ confirmation: Binding<JarvisSuccessConfirmation?>) -> some View {
        modifier(JarvisSuccessFeedbackModifier(confirmation: confirmation))
    }
}
