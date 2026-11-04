import JarvisCore
import SwiftUI

/// The pieces that stay on screen while Today, Chat and Voice swap: the composer and the orb.
enum JarvisCarryOverElement: Hashable {
    case composer
    case orb
}

private struct JarvisCarryOverNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    var jarvisCarryOver: Namespace.ID? {
        get { self[JarvisCarryOverNamespaceKey.self] }
        set { self[JarvisCarryOverNamespaceKey.self] = newValue }
    }
}

/// Continuity between Today, Chat and Voice. With Reduce Motion on, nothing moves: the swap is a short cross-fade.
enum JarvisCarryOver {
    static func applies(from: JarvisDestination, to: JarvisDestination) -> Bool {
        let carried: Set<JarvisDestination> = [.today, .chat, .voice]
        return from != to && carried.contains(from) && carried.contains(to)
    }

    static func animation(reduceMotion: Bool) -> Animation {
        reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.45)
    }
}

private struct JarvisCarryOverModifier: ViewModifier {
    @Environment(\.jarvisCarryOver) private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let element: JarvisCarryOverElement

    @ViewBuilder
    func body(content: Content) -> some View {
        if let namespace, !reduceMotion {
            content.matchedGeometryEffect(id: element, in: namespace)
        } else {
            content
        }
    }
}

extension View {
    func jarvisCarryOver(_ element: JarvisCarryOverElement) -> some View {
        modifier(JarvisCarryOverModifier(element: element))
    }
}

/// What Today hands to Chat: a message typed on Home, which Chat sends on arrival, or a choice made in the
/// composer plus menu, which Chat performs (the typed text, if any, stays in the composer).
struct JarvisChatHandoff: Equatable {
    let id = UUID()
    let text: String
    var action: JarvisComposerPlusAction?
}
