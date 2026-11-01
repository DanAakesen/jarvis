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
        state.openSidebar()
    }

    func closeSidebar() {
        state.closeSidebar()
    }

    func setPath(_ path: [JarvisDestination]) {
        guard path != state.path else { return }
        state.setPath(path)
        state.closeSidebar()
    }

    func navigate(to destination: JarvisDestination) {
        state.navigate(to: destination)
    }

    func voiceSessionStateChanged(_ voiceState: VoiceSessionState) {
        state.voiceSessionStateChanged(voiceState)
    }

    func reset() {
        state = JarvisNavigationState()
    }
}
