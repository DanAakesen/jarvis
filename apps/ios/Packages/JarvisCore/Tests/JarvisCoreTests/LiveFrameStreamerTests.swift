import XCTest
@testable import JarvisCore

private actor Recorder {
    var frames: [Data] = []
    var captures = 0
    func record(_ frame: Data) { frames.append(frame) }
    func nextCapture() -> Int { captures += 1; return captures }
}

private func frame(_ byte: UInt8) -> Data { Data([0xff, 0xd8, byte, 0xff, 0xd9]) }

final class LiveFrameStreamerTests: XCTestCase {
    func testScreenSkipsUnchangedFramesButKeepsSampling() async {
        let recorder = Recorder()
        let sequence = [frame(1), frame(1), frame(2)]
        let streamer = LiveFrameStreamer(
            source: .screen,
            capture: {
                let index = await recorder.nextCapture() - 1
                return index < sequence.count ? sequence[index] : nil
            },
            post: { data in await recorder.record(data); return .accepted },
            sleep: { _ in if await recorder.captures >= 4 { throw CancellationError() } }
        )
        let stoppedByBackend = await streamer.run()
        let posted = await recorder.frames
        XCTAssertFalse(stoppedByBackend)
        XCTAssertEqual(posted, [frame(1), frame(2)])
    }

    func testCameraPostsEveryFrameEvenWhenTheSceneIsStill() async {
        let recorder = Recorder()
        let streamer = LiveFrameStreamer(
            source: .camera,
            capture: { _ = await recorder.nextCapture(); return frame(7) },
            post: { data in await recorder.record(data); return .accepted },
            sleep: { _ in if await recorder.captures >= 3 { throw CancellationError() } }
        )
        await streamer.run()
        let count = await recorder.frames.count
        XCTAssertEqual(count, 3)
    }

    func testBackendStopEndsTheStream() async {
        let streamer = LiveFrameStreamer(
            source: .screen,
            capture: { frame(1) },
            post: { _ in .stop },
            sleep: { _ in }
        )
        let stopped = await streamer.run()
        XCTAssertTrue(stopped)
    }

    func testRateLimitedFramesAreRetriedAndRepeatedFailuresStop() async {
        let recorder = Recorder()
        let limited = LiveFrameStreamer(
            source: .camera,
            capture: { _ = await recorder.nextCapture(); return frame(1) },
            post: { _ in .rateLimited },
            sleep: { _ in if await recorder.captures >= 5 { throw CancellationError() } }
        )
        let stoppedByLimit = await limited.run()
        XCTAssertFalse(stoppedByLimit)

        struct Failure: Error {}
        let failing = LiveFrameStreamer(
            source: .camera, capture: { frame(1) }, post: { _ in throw Failure() }, sleep: { _ in }
        )
        let stoppedByFailure = await failing.run()
        XCTAssertTrue(stoppedByFailure)
    }
}
