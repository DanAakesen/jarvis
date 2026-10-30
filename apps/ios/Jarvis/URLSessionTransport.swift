import Foundation
import JarvisCore

public final class URLSessionTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        do {
            let (body, response) = try await session.data(for: Self.urlRequest(from: request))
            return try Self.httpResponse(response, body: body)
        } catch {
            throw Self.transportError(for: error)
        }
    }

    public func stream(_ request: HTTPRequest) async throws -> HTTPStreamResponse {
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: Self.urlRequest(from: request))
        } catch {
            throw Self.transportError(for: error)
        }

        let metadata = try Self.httpResponse(response, body: Data())
        let body = AsyncThrowingStream<Data, any Error> { continuation in
            let producer = Task {
                do {
                    var chunk = Data()
                    chunk.reserveCapacity(16_384)
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        chunk.append(byte)
                        if chunk.count == 16_384 {
                            if case .terminated = continuation.yield(chunk) { return }
                            chunk.removeAll(keepingCapacity: true)
                        }
                    }
                    if !chunk.isEmpty { continuation.yield(chunk) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.transportError(for: error))
                }
            }
            continuation.onTermination = { @Sendable _ in producer.cancel() }
        }
        return HTTPStreamResponse(statusCode: metadata.statusCode, headers: metadata.headers, body: body)
    }

    private static func urlRequest(from request: HTTPRequest) -> URLRequest {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        let timeout = request.timeout.components
        urlRequest.timeoutInterval = max(
            Double(timeout.seconds) + Double(timeout.attoseconds) / 1_000_000_000_000_000_000,
            0.001
        )
        for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        return urlRequest
    }

    private static func httpResponse(_ response: URLResponse, body: Data) throws -> HTTPResponse {
        guard let response = response as? HTTPURLResponse else {
            throw HTTPTransportFailure.network
        }
        var headers: [String: String] = [:]
        for (name, value) in response.allHeaderFields {
            headers[String(describing: name)] = String(describing: value)
        }
        return HTTPResponse(statusCode: response.statusCode, headers: headers, body: body)
    }

    private static func transportError(for error: any Error) -> any Error {
        if error is CancellationError { return error }
        guard let urlError = error as? URLError else { return HTTPTransportFailure.network }
        switch urlError.code {
        case .timedOut:
            return HTTPTransportFailure.timedOut
        case .cancelled:
            return CancellationError()
        default:
            return HTTPTransportFailure.network
        }
    }
}
