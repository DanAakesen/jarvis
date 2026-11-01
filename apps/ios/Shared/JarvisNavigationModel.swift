import Combine
import JarvisCore

@MainActor
final class JarvisNavigationModel: ObservableObject {
    @Published private(set) var state: JarvisNavigationState
    // TEMPORARY debug instrumentation for the on-device sidebar investigation; remove once it opens.
    @Published private(set) var openTapCount = 0
    @Published private(set) var recentSidebarWrites: [String] = []
    private let dismissKeyboard: () -> Void

    init(initialState: JarvisNavigationState = JarvisNavigationState(),
         dismissKeyboard: @escaping () -> Void = {}) {
        state = initialState
        self.dismissKeyboard = dismissKeyboard
    }

    var path: [JarvisDestination] { state.path }
    var isSidebarOpen: Bool { state.isSidebarOpen }
    var currentDestination: JarvisDestination { state.currentDestination }

    func openSidebar(caller: String = "\(#fileID):\(#line)") {
        openTapCount += 1
        dismissKeyboard()
        write(caller: caller) { $0.openSidebar() }
    }

    func closeSidebar(caller: String = "\(#fileID):\(#line)") {
        write(caller: caller) { $0.closeSidebar() }
    }

    func setPath(_ path: [JarvisDestination], caller: String = "\(#fileID):\(#line)") {
        guard path != state.path else { return }
        write(caller: caller) {
            $0.setPath(path)
            $0.closeSidebar()
        }
    }

    func navigate(to destination: JarvisDestination, caller: String = "\(#fileID):\(#line)") {
        write(caller: caller) { $0.navigate(to: destination) }
    }

    func voiceSessionStateChanged(_ voiceState: VoiceSessionState, caller: String = "\(#fileID):\(#line)") {
        write(caller: caller) { $0.voiceSessionStateChanged(voiceState) }
    }

    func reset() {
        state = JarvisNavigationState()
    }

    private func write(caller: String, _ change: (inout JarvisNavigationState) -> Void) {
        let before = state.isSidebarOpen
        change(&state)
        guard state.isSidebarOpen != before else { return }
        recentSidebarWrites = Array((recentSidebarWrites + ["\(state.isSidebarOpen ? "open" : "close") \(caller)"]).suffix(3))
    }
}
