import ImageIO
import JarvisCore
import UIKit
import XCTest

final class ChatPhotoLoaderTests: XCTestCase {
    func testBlobRequestDoesNotForwardCredentialsOrPersistCache() async throws {
        let expected = Data([1, 2, 3])
        PhotoTestProtocol.state.install(status: 200, headers: ["Content-Type": "image/jpeg"], body: expected)
        let loader = makeLoader()
        let data = try await loader.data(from: photoURL)
        XCTAssertEqual(data, expected)
        let request = try XCTUnwrap(PhotoTestProtocol.state.request)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
    }

    func testBlobErrorsInvalidContentAndOversizedResponsesFail() async throws {
        for (status, type, length, body) in [
            (403, "image/jpeg", "1", Data([1])),
            (404, "image/jpeg", "1", Data([1])),
            (200, "text/html", "1", Data([1])),
            (200, "image/jpeg", "0", Data()),
            (200, "image/jpeg", "\(ChatAttachmentLimits.maximumImageBytes + 1)", Data([1])),
        ] {
            PhotoTestProtocol.state.install(
                status: status, headers: ["Content-Type": type, "Content-Length": length], body: body
            )
            do {
                _ = try await makeLoader().data(from: photoURL)
                XCTFail("An unavailable or invalid image must show the fallback")
            } catch {
                XCTAssertEqual(error as? JarvisChatClientError, .invalidResponse)
            }
        }
    }

    @MainActor
    func testThumbnailPreservesLandscapePortraitAndEXIFOrientationWithoutChangingSource() async throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 400))
        let original = renderer.image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
        }.cgImage!
        for (orientation, width, height) in [(1, 120, 60), (6, 60, 120)] {
            let source = NSMutableData()
            let destination = try XCTUnwrap(CGImageDestinationCreateWithData(
                source as CFMutableData, "public.jpeg" as CFString, 1, nil
            ))
            CGImageDestinationAddImage(destination, original, [
                kCGImagePropertyOrientation: orientation,
            ] as CFDictionary)
            XCTAssertTrue(CGImageDestinationFinalize(destination))
            let data = source as Data
            let unchanged = data
            let thumbnail = await JarvisChatPhotoDecoder.shared.thumbnail(data, maximumPixelSize: 120)
            let image = try XCTUnwrap(thumbnail)
            XCTAssertEqual(image.width, width)
            XCTAssertEqual(image.height, height)
            XCTAssertEqual(data, unchanged)
        }
        let invalid = await JarvisChatPhotoDecoder.shared.thumbnail(Data([1, 2, 3]), maximumPixelSize: 120)
        XCTAssertNil(invalid)
    }

    private var photoURL: URL { URL(string: "https://photo-test.blob.core.windows.net/synthetic.jpg")! }

    private func makeLoader() -> JarvisChatPhotoLoader {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PhotoTestProtocol.self]
        return JarvisChatPhotoLoader(configuration: configuration)
    }
}

private final class PhotoTestProtocol: URLProtocol, @unchecked Sendable {
    static let state = PhotoTestState()
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "photo-test.blob.core.windows.net"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.state.respond(self) }
    override func stopLoading() {}
}

private final class PhotoTestState: @unchecked Sendable {
    private let lock = NSLock()
    private var status = 200
    private var headers: [String: String] = [:]
    private var body = Data()
    private var lastRequest: URLRequest?

    var request: URLRequest? {
        lock.lock()
        defer { lock.unlock() }
        return lastRequest
    }

    func install(status: Int, headers: [String: String], body: Data) {
        lock.lock()
        defer { lock.unlock() }
        self.status = status
        self.headers = headers
        self.body = body
        lastRequest = nil
    }

    func respond(_ connection: URLProtocol) {
        lock.lock()
        lastRequest = connection.request
        let response = HTTPURLResponse(
            url: connection.request.url!, statusCode: status, httpVersion: nil, headerFields: headers
        )!
        let data = body
        lock.unlock()
        connection.client?.urlProtocol(connection, didReceive: response, cacheStoragePolicy: .notAllowed)
        connection.client?.urlProtocol(connection, didLoad: data)
        connection.client?.urlProtocolDidFinishLoading(connection)
    }
}
