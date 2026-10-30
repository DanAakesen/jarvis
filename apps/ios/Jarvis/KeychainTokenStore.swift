import Foundation
import JarvisCore
import Security

public enum KeychainTokenStoreError: Error, Equatable, Sendable {
    case missingService
    case invalidData
    case keychainStatus(OSStatus)
}

public struct KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    public init(
        service: String? = Bundle.main.bundleIdentifier,
        account: String = "owner-session"
    ) throws {
        guard let service, !service.isEmpty else {
            throw KeychainTokenStoreError.missingService
        }
        self.service = service
        self.account = account
    }

    public func read() async throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw KeychainTokenStoreError.keychainStatus(status)
        }
        guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainTokenStoreError.invalidData
        }
        return token
    }

    public func write(_ token: String) async throws {
        let data = Data(token.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainTokenStoreError.keychainStatus(updateStatus)
        }

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess { return }
        if addStatus == errSecDuplicateItem {
            let retryStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
            if retryStatus == errSecSuccess { return }
            throw KeychainTokenStoreError.keychainStatus(retryStatus)
        }
        throw KeychainTokenStoreError.keychainStatus(addStatus)
    }

    public func delete() async throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainTokenStoreError.keychainStatus(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
    }
}
