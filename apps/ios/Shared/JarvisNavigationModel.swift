import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    @Published private(set) var sidebarDiagnostics = JarvisSidebarDiagnostics()
    let navigationRequested = PassthroughSubject<(from: JarvisDestination, to: JarvisDestination), Never>()
    private let dismissKeyboard: () -> Void

    init(initialState: JarvisNavigationState = JarvisNavigationState(),
         dismissKeyboard: @escaping () -> Void = {}) {
        state = initialState
        self.dismissKeyboard = dismissKeyboard
        sidebarDiagnostics.record(
            caller: .initial, requested: initialState.isSidebarOpen,
            before: false, after: initialState.isSidebarOpen
        )
    }

    var path: [JarvisDestination] { state.path }
    var isSidebarOpen: Bool { state.isSidebarOpen }
    var currentDestination: JarvisDestination { state.currentDestination }

    func openSidebar(caller: JarvisSidebarWriter) {
        dismissKeyboard()
        writeSidebar(caller: caller, requested: true) { $0.openSidebar() }
    }

    func closeSidebar(caller: JarvisSidebarWriter) {
        writeSidebar(caller: caller, requested: false) { $0.closeSidebar() }
    }

    func setPath(_ path: [JarvisDestination], caller: JarvisSidebarWriter) {
        let update = JarvisNavigationPathUpdate(path: path, from: state)
        if let request = update.navigationRequest {
            navigationRequested.send(request)
        }
        writeSidebar(caller: caller, requested: false) { $0 = update.state }
    }

    func navigate(to destination: JarvisDestination, caller: JarvisSidebarWriter) {
        // Content owns voice/fixture side effects; deliver before changing the route.
        if destination.isNavigable {
            navigationRequested.send((from: currentDestination, to: destination))
        }
        writeSidebar(caller: caller, requested: false) { $0.navigate(to: destination) }
    }

    func voiceSessionStateChanged(_ voiceState: VoiceSessionState) {
        writeSidebar(
            caller: voiceState == .ended ? .voiceEnded : .voiceState,
            requested: voiceState == .ended ? false : isSidebarOpen
        ) { $0.voiceSessionStateChanged(voiceState) }
    }

    func reset(caller: JarvisSidebarWriter) {
        writeSidebar(caller: caller, requested: false) { $0 = JarvisNavigationState() }
    }

    private func writeSidebar(
        caller: JarvisSidebarWriter, requested: Bool,
        mutation: (inout JarvisNavigationState) -> Void
    ) {
        let before = isSidebarOpen
        var next = state
        mutation(&next)
        if next != state { state = next }
        sidebarDiagnostics.record(caller: caller, requested: requested, before: before, after: isSidebarOpen)
        print("Jarvis sidebar caller=\(caller.rawValue) requested=\(requested) before=\(before) after=\(isSidebarOpen) taps=\(sidebarDiagnostics.buttonTapCount)")
    }
}
