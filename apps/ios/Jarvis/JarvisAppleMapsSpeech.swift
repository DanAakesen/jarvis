import AVFoundation
import JarvisCore
import UIKit

@MainActor
final class JarvisAppleMapsSpeech: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var completion: CheckedContinuation<Bool, Never>?
    private var activeUtterance: ObjectIdentifier?
    private var microphoneResumeAt = Date.distantPast
    var suppressMicrophone: Bool { activeUtterance != nil || Date() < microphoneResumeAt }

    override init() {
        super.init()
        synthesizer.delegate = self
        synthesizer.usesApplicationAudioSession = true
        NotificationCenter.default.addObserver(self, selector: #selector(stop), name: UIApplication.willResignActiveNotification, object: nil)
    }

    func speak(_ result: AppleMapsResult) async -> Bool {
        guard UIApplication.shared.applicationState == .active, completion == nil, !Task.isCancelled else { return false }
        let text: String
        if result.places.count > 1 {
            text = "Apple Maps found " + result.places.map(\.name).joined(separator: ", ") + ". Which one?"
        } else if let place = result.places.first {
            if let seconds = place.travelSeconds, let minutes = place.travelMinutes {
                var summary = "\(place.name) is about \(minutes) minutes away."
                if let arriveBy = result.arriveBy, let arrival = AppleMapsRequest(query: place.name, arriveBy: arriveBy, bufferMinutes: result.bufferMinutes).arrivalDate {
                    let leave = arrival.addingTimeInterval(-seconds)
                    let date = leave.formatted(date: Calendar.current.isDateInToday(leave) ? .omitted : .abbreviated, time: .shortened)
                    summary += " Leave by \(date)."
                }
                text = summary
            } else {
                text = [place.name, place.address, result.reason].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ". ")
            }
        } else {
            text = result.reason ?? "Apple Maps found no matching places."
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: false); return }
                completion = continuation
                activeUtterance = ObjectIdentifier(utterance)
                synthesizer.speak(utterance)
            }
        } onCancel: { Task { @MainActor [weak self] in self?.stop() } }
    }

    @objc func stop() {
        guard let activeUtterance else { return }
        synthesizer.stopSpeaking(at: .immediate)
        finish(activeUtterance, spoken: false)
    }

    private func finish(_ id: ObjectIdentifier, spoken: Bool) {
        guard activeUtterance == id else { return }
        activeUtterance = nil
        microphoneResumeAt = Date().addingTimeInterval(0.25)
        completion?.resume(returning: spoken)
        completion = nil
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in finish(id, spoken: true) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in finish(id, spoken: false) }
    }
}
