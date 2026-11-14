import Foundation
import JarvisCore
import Security

@MainActor
enum WatchDirectDictation {
    private static let key: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.danaakesen.jarvis.watch-dictation",
        kSecAttrAccount as String: "transcription",
        kSecAttrSynchronizable as String: false,
    ]

    static var trustedOrigin: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "JARVIS_API_BASE_URL") as? String else { return nil }
        return URL(string: value)
    }

    static func clear() { SecItemDelete(key as CFDictionary) }

    static func store(_ data: Data) throws {
        guard data.count < 2_048, let origin = trustedOrigin,
              let value = try? JSONDecoder().decode(WatchDictationCredential.self, from: data),
              value.isUsable(trustedOrigin: origin) else { clear(); return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(key.merging(attributes) { _, value in value } as CFDictionary, nil) == errSecSuccess else {
                throw WatchFailure.credentialStorage
            }
        } else if status != errSecSuccess {
            throw WatchFailure.credentialStorage
        }
    }

    static func credential() throws -> WatchDictationCredential? {
        var query = key
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw WatchFailure.credentialStorage }
        guard let data = result as? Data, let origin = trustedOrigin,
              let value = try? JSONDecoder().decode(WatchDictationCredential.self, from: data),
              value.isUsable(trustedOrigin: origin) else { clear(); return nil }
        return value
    }

    static func transcribe(_ audio: Data) async throws -> String {
        guard let credential = try credential(), let origin = trustedOrigin else { throw WatchFailure.signInRequired }
        let request = try credential.request(audio: audio, trustedOrigin: origin)
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.timeoutInterval = WatchDictationDeadline.directSeconds
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForResource = WatchDictationDeadline.directSeconds
        let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.bytes(for: urlRequest)
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse else { throw WatchFailure.network }
            if response.statusCode == 401 || response.statusCode == 403 {
                if try Self.credential().map({ $0.token == credential.token }) == true { clear() }
                throw WatchFailure.signInRequired
            }
            if let failure = WatchDictationError.forHTTPStatus(response.statusCode) { throw failure }
            guard response.statusCode == 200 else { throw WatchFailure.network }
            var data = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < WatchLimits.payloadBytes else { throw WatchFailure.failed }
                data.append(byte)
            }
            struct Result: Decodable { let text: String }
            let text = try JSONDecoder().decode(Result.self, from: data).text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.utf8.count <= 8_000 else { throw WatchFailure.failed }
            return text
        } catch is CancellationError { throw CancellationError() }
        catch let failure as WatchDictationError { try Task.checkCancellation(); throw failure }
        catch let failure as WatchFailure { try Task.checkCancellation(); throw failure }
        catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            if (error as? URLError)?.code == .timedOut { throw WatchDictationError.timedOut }
            throw WatchFailure.network
        }
    }

    private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
}
