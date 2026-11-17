import Foundation
import XCTest
@testable import JarvisCore

final class WatchCaptureLevelTests: XCTestCase {
    private func pcm(_ values: [Int16]) -> Data {
        var data = Data()
        for value in values {
            let bits = UInt16(bitPattern: value).littleEndian
            data.append(UInt8(truncatingIfNeeded: bits))
            data.append(UInt8(truncatingIfNeeded: bits >> 8))
        }
        return data
    }

    func testDigitalSilenceIsReportedSilent() {
        var level = WatchCaptureLevel()
        XCTAssertFalse(level.hasAudio)
        XCTAssertFalse(level.isSilent)
        level.add(pcm: pcm([0, 0, 3, -4, 0]))
        XCTAssertTrue(level.hasAudio)
        XCTAssertTrue(level.isSilent)
        XCTAssertEqual(level.peak, 4)
        XCTAssertEqual(level.samples, 5)
    }

    func testSoundBelowAndAboveTheFloor() {
        var level = WatchCaptureLevel()
        level.add(pcm: pcm([7, -7]))
        XCTAssertTrue(level.isSilent)
        level.add(pcm: pcm([-300, 12]))
        XCTAssertFalse(level.isSilent)
        XCTAssertEqual(level.peak, 300)
    }

    func testExtremeNegativeSampleAndOddTrailingByte() {
        var level = WatchCaptureLevel()
        var data = pcm([Int16.min])
        data.append(0x7F)
        level.add(pcm: data)
        XCTAssertEqual(level.peak, 32_768)
        XCTAssertEqual(level.samples, 1)
    }

    func testLiveVoiceIsDeafOnlyAfterEnoughSilentAudio() {
        var level = WatchCaptureLevel()
        level.add(pcm: Data(count: 2 * (WatchCaptureLevel.liveListeningSamples - 1)))
        XCTAssertFalse(level.isDeaf)
        level.add(pcm: Data(count: 2))
        XCTAssertTrue(level.isDeaf)
        level.add(pcm: pcm([1_000]))
        XCTAssertFalse(level.isDeaf)
    }
}
