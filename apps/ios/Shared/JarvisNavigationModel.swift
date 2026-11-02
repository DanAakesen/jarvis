import Foundation
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

    /// Called from a view's onAppear: skip redundant writes and publish after the current view update,
    /// so reporting what is shown can never feed back into the render that reported it.
    func debugDestinationShown(_ destination: JarvisDestination) {
        guard debugShown != destination.rawValue else { return }
        Task { @MainActor [weak self] in
            guard let self, self.debugShown != destination.rawValue else { return }
            self.debugShown = destination.rawValue
        }
    }

    func openSidebar() {
        dismissKeyboard()
        write("openSidebar") { $0.openSidebar() }
    }

    func closeSidebar() {
        write("closeSidebar") { $0.closeSidebar() }
    }

    func setPath(_ path: [JarvisDestination]) {
        // NavigationStack can echo its pre-push path back through the binding right after a programmatic
        // navigate(to:); treat a shrinking echo inside the push transition as stale, never as a user pop.
        if path.count < state.path.count, Date().timeIntervalSince(lastProgrammaticNavigation) < 0.8 {
            note("setPath(binding) dropped stale \(path.map(\.rawValue))")
            return
        }
        guard path != state.path else {
            note("setPath(binding) ignored \(path.map(\.rawValue))")
            return
        }
        let update = JarvisNavigationPathUpdate(path: path, from: state)
        if let request = update.navigationRequest {
            navigationRequested.send(request)
        }
        write("setPath(binding) \(path.map(\.rawValue))") { $0 = update.state }
    }

    func navigate(to destination: JarvisDestination) {
        lastProgrammaticNavigation = Date()
        // Content owns voice/fixture side effects; deliver before changing the route.
        if destination.isNavigable {
            navigationRequested.send((from: currentDestination, to: destination))
        }
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
