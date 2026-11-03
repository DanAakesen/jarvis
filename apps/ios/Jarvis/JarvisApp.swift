import SwiftUI

@main
struct JarvisApp: App {
    @UIApplicationDelegateAdaptor(JarvisAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--component-gallery") {
                JarvisComponentGallery()
            } else {
                appRoot
            }
            #else
            appRoot
            #endif
        }
    }

    @ViewBuilder
    private var appRoot: some View {
        Group {
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
