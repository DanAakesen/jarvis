import ActivityKit
import Foundation
import JarvisCore

@MainActor
final class VoiceLiveActivityController {
    private var activity: Activity<VoiceActivityAttributes>?
    private var updateTask: Task<Void, Never>?
    private var lastWaveformUpdate = Date.distantPast
    private var waveform = Array(repeating: 0.0, count: VoiceWaveform.sampleCount)
    private var lastState: VoiceActivityAttributes.ContentState?

    init() {
        // A cold launch cannot resume an in-memory voice socket.
        let orphaned = Activity<VoiceActivityAttributes>.activities
        Task {
            for activity in orphaned {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    func start(
        sessionID: UUID, language: JarvisAppLanguage,
        startedAt: Date = Date(), waveform: [Double]? = nil
    ) throws {
        guard activity == nil, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        self.waveform = waveform ?? Array(repeating: 0, count: VoiceWaveform.sampleCount)
        let state = VoiceActivityAttributes.ContentState(
            phase: .listening, isMuted: false, waveform: self.waveform
        )
        activity = try Activity.request(
            attributes: VoiceActivityAttributes(
                sessionID: sessionID, startedAt: startedAt, language: language.rawValue
            ),
            content: ActivityContent(state: state, staleDate: nil),
            pushType: nil
        )
        lastState = state
    }

    func update(state: VoiceSessionState, isMuted: Bool, pcm16: Data? = nil) {
        guard let activity else { return }
        switch state {
        case .idle, .ended, .failed: return
        default: break
        }
        let phase = VoiceLiveActivityPhase(state: state, isMuted: isMuted)
        let isQuiet = isMuted || phase == .thinking || phase == .connecting || phase == .reconnecting
        if isQuiet {
            waveform = Array(repeating: 0, count: VoiceWaveform.sampleCount)
        } else if let pcm16 {
            waveform.removeFirst()
            waveform.append(VoiceWaveform.level(pcm16: pcm16))
        }
        let content = VoiceActivityAttributes.ContentState(
            phase: phase, isMuted: isMuted, waveform: waveform
        )
        let changedState = lastState?.phase != phase || lastState?.isMuted != isMuted
        guard changedState || Date().timeIntervalSince(lastWaveformUpdate) >= 1 else { return }
        lastWaveformUpdate = Date()
        lastState = content
        let previous = updateTask
        updateTask = Task {
            await previous?.value
            guard !Task.isCancelled else { return }
            await activity.update(ActivityContent(state: content, staleDate: nil))
        }
    }

    func end() async {
        guard let activity else { return }
        self.activity = nil
        let pending = updateTask
        updateTask = nil
        pending?.cancel()
        await pending?.value
        await activity.end(nil, dismissalPolicy: .immediate)
        lastState = nil
    }
}
