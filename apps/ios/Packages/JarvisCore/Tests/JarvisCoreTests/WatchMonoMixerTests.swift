import XCTest
@testable import JarvisCore

final class WatchMonoMixerTests: XCTestCase {
    func testSingleChannelPassesThrough() {
        XCTAssertEqual(WatchMonoMixer.mix([[0.5, -0.25, 0.125]]), [0.5, -0.25, 0.125])
    }

    func testVoiceOnOneChannelIsNotAttenuatedByAnEmptyChannel() {
        // The second and third channels are exactly silent; the voice must keep its level.
        XCTAssertEqual(WatchMonoMixer.mix([[0.4, -0.4], [0, 0], [0, 0]]), [0.4, -0.4])
    }

    func testActiveChannelsAreAveraged() {
        let mixed = WatchMonoMixer.mix([[0.5, 0.5], [0.1, -0.3], [0, 0]])
        XCTAssertEqual(mixed[0], 0.3, accuracy: 1e-6)
        XCTAssertEqual(mixed[1], 0.1, accuracy: 1e-6)
    }

    func testAllSilentChannelsStaySilentAndDoNotInventSignal() {
        XCTAssertEqual(WatchMonoMixer.mix([[0, 0, 0], [0, 0, 0]]), [0, 0, 0])
        XCTAssertEqual(WatchMonoMixer.mix([]), [])
    }
}
