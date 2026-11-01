import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    /// Finger-tracked reveal progress (0...1) while a swipe is in flight; nil whenever no swipe is active.
    @Published private(set) var dragProgress: Double?
    // TEMPORARY on-device diagnosis (path writes); remove once item navigation is confirmed.
    @Published private(set) var debugWrites: [String] = []
    @Published private(set) var debugShown = "-"
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

    func debugDestinationShown(_ destination: JarvisDestination) {
        debugShown = destination.rawValue
    }

    func openSidebar() {
        dismissKeyboard()
        write("openSidebar") { $0.openSidebar() }
    }

    func closeSidebar() {
        write("closeSidebar") { $0.closeSidebar() }
    }

    func setPath(_ path: [JarvisDestination]) {
        guard path != state.path else {
            note("setPath(binding) ignored \(path.map(\.rawValue))")
            return
        }
        write("setPath(binding) \(path.map(\.rawValue))") {
            $0.setPath(path)
            $0.closeSidebar()
        }
    }

    func navigate(to destination: JarvisDestination) {
        write("navigate(\(destination.rawValue))") { $0.navigate(to: destination) }
    }

    func voiceSessionStateChanged(_ voiceState: VoiceSessionState) {
        write("voice(\(voiceState))") { $0.voiceSessionStateChanged(voiceState) }
    }

    func reset() {
        note("reset")
        dragProgress = nil
        state = JarvisNavigationState()
    }

    private func write(_ label: String, _ change: (inout JarvisNavigationState) -> Void) {
        dragProgress = nil
        change(&state)
        note("\(label) -> \(state.path.map(\.rawValue)) open=\(state.isSidebarOpen)")
    }

    private func note(_ line: String) {
        debugWrites = Array((debugWrites + [line]).suffix(4))
    }
}
