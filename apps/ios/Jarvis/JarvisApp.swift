import SwiftUI

@main
struct JarvisApp: App {
    init() {
        JarvisUITestConfiguration.configureDefaults()
    }

    var body: some Scene {
        WindowGroup {
            JarvisGateRootView()
        }
    }
}
