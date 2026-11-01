import SwiftUI

@main
struct JarvisApp: App {
    @UIApplicationDelegateAdaptor(JarvisAppDelegate.self) private var appDelegate

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
