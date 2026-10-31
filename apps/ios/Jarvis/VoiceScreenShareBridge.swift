import Foundation

struct VoiceScreenShareBridge {
    private let fileManager = FileManager.default

    private var containerURL: URL? {
        VoiceScreenShareContract.containerURL()
    }

    var isSharing: Bool {
        guard let containerURL else { return false }
        let activeURL = containerURL.appendingPathComponent(VoiceScreenShareContract.activeFileName)
        guard let attributes = try? fileManager.attributesOfItem(atPath: activeURL.path),
              let modifiedAt = attributes[.modificationDate] as? Date else {
            return false
        }
        return Date().timeIntervalSince(modifiedAt) <= VoiceScreenShareContract.markerFreshness
    }

    func latestFrame() -> Data? {
        guard let containerURL else { return nil }
        let frameURL = containerURL.appendingPathComponent(VoiceScreenShareContract.frameFileName)
        guard let attributes = try? fileManager.attributesOfItem(atPath: frameURL.path),
              let modifiedAt = attributes[.modificationDate] as? Date,
              Date().timeIntervalSince(modifiedAt) <= VoiceScreenShareContract.markerFreshness,
              let data = try? Data(contentsOf: frameURL),
              data.count >= VoiceScreenShareContract.minimumJPEGBytes,
              data.count <= VoiceScreenShareContract.maximumFrameBytes,
              data.starts(with: VoiceScreenShareContract.jpegStartMarker),
              data.suffix(2).elementsEqual(VoiceScreenShareContract.jpegEndMarker) else {
            return nil
        }
        return data
    }

    func requestStop() {
        guard let containerURL else { return }
        try? Data().write(
            to: containerURL.appendingPathComponent(VoiceScreenShareContract.stopFileName),
            options: .atomic
        )
    }
}
