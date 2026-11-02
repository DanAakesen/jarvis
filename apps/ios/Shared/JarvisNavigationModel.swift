import Foundation
import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    /// Finger-tracked reveal progress (0...1) while a swipe is in flight; nil whenever no swipe is active.
    @Published private(set) var dragProgress: Double?
    private var lastProgrammaticNavigation = Date.distantPast
    let navigationRequested = PassthroughSubject<(from: JarvisDestination, to: JarvisDestination), Never>()
    private let dismissKeyboard: () -> Void

    init(initialState: JarvisNavigationState = JarvisNavigationState(),
         dismissKeyboard: @escaping () -> Void = {}) {
        state = initialState
        self.dismissKeyboard = dismissKeyboard
    }

    var path: [JarvisDestination] { state.path }
    var isSidebarOpen: Bool { state.isSidebarOpen }
    var currentDestination: JarvisDestination { state.currentDestination }

    /// What the page offset and the drawer render from: the live swipe if there is one, else the committed state.
    var revealProgress: Double { dragProgress ?? (state.isSidebarOpen ? 1 : 0) }

    func updateDrag(progress: Double) {
        guard progress.isFinite else { return }
        dragProgress = min(max(progress, 0), 1)
    }

    /// A cancelled, failed or non-committing swipe returns to the committed state.
    func cancelDrag() {
        guard dragProgress != nil else { return }
        dragProgress = nil
    }

    func openSidebar() {
        dismissKeyboard()
        write { $0.openSidebar() }
    }

    func closeSidebar() {
        write { $0.closeSidebar() }
    }

    func setPath(_ path: [JarvisDestination]) {
        // NavigationStack can echo its pre-push path back through the binding right after a programmatic
        // navigate(to:); treat a shrinking echo inside the push transition as stale, never as a user pop.
        if path.count < state.path.count, Date().timeIntervalSince(lastProgrammaticNavigation) < 0.8 {
            return
        }
        guard path != state.path else {
            return
        }
        let update = JarvisNavigationPathUpdate(path: path, from: state)
        if let request = update.navigationRequest {
            navigationRequested.send(request)
        }
        write { $0 = update.state }
    }

    func navigate(to destination: JarvisDestination) {
        lastProgrammaticNavigation = Date()
        // Content owns voice/fixture side effects; deliver before changing the route.
        if destination.isNavigable {
            navigationRequested.send((from: currentDestination, to: destination))
        }
        write { $0.navigate(to: destination) }
    }

    func voiceSessionStateChanged(_ voiceState: VoiceSessionState) {
        write { $0.voiceSessionStateChanged(voiceState) }
    }

    func reset() {
        dragProgress = nil
        state = JarvisNavigationState()
    }

    private func write(_ change: (inout JarvisNavigationState) -> Void) {
        dragProgress = nil
        change(&state)
    }
}
