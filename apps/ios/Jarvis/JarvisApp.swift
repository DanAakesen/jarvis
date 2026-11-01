import SwiftUI

@main
struct JarvisApp: App {
    init() {
        JarvisUITestConfiguration.configureDefaults()
    }

    var body: some Scene {
        WindowGroup {
            #if targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--screenshot-voice-activity-fixture") {
                VoiceActivityScreenshotView()
            } else {
                JarvisGateRootView()
            }
            #else
            JarvisGateRootView()
            #endif
        }
    }
}
