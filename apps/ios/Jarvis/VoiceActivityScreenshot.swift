#if targetEnvironment(simulator)
import JarvisCore
import SwiftUI

struct VoiceActivityScreenshotView: View {
    @StateObject private var model = VoiceScreenModel()

    var body: some View {
        VoiceScreenView(model: model, onMinimize: {})
            .task { await model.startActivityScreenshot() }
    }
}

actor VoiceActivityScreenshotSocket: WebSocketTransport {
    func connect(url: URL, subprotocols: [String]) async throws {}
    func send(text: String) async throws {}
    func receive() async -> AsyncThrowingStream<String, any Error> {
        AsyncThrowingStream { _ in }
    }
    func close(code: UInt16) async {}
}
#endif
