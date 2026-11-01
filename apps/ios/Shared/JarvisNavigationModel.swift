import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    private let dismissKeyboard: () -> Void

    init(initialState: JarvisNavigationState = JarvisNavigationState(),
         dismissKeyboard: @escaping () -> Void = {}) {
        state = initialState
        self.dismissKeyboard = dismissKeyboard
    }

    var path: [JarvisDestination] { state.path }
    var isSidebarOpen: Bool { state.isSidebarOpen }
    var currentDestination: JarvisDestination { state.currentDestination }

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
        state = JarvisNavigationState()
    }

    private func write(_ change: (inout JarvisNavigationState) -> Void) {
        change(&state)
    }
}
