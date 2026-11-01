import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    /// Finger-tracked reveal progress (0...1) while a swipe is in flight; nil whenever no swipe is active.
    @Published private(set) var dragProgress: Double?
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
        guard path != state.path else { return }
        write {
            $0.setPath(path)
            $0.closeSidebar()
        }
    }

    func navigate(to destination: JarvisDestination) {
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
