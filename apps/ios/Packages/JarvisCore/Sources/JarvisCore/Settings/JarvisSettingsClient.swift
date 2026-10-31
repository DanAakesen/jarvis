import Foundation

public indirect enum JarvisSettingsValue: Codable, Equatable, Sendable {
    case object([String: JarvisSettingsValue])
    case array([JarvisSettingsValue])
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let result = try? value.decode(Bool.self) {
            self = .boolean(result)
        } else if let result = try? value.decode(Int.self) {
            self = .integer(result)
        } else if let result = try? value.decode(Double.self) {
            self = .number(result)
        } else if let result = try? value.decode(String.self) {
            self = .string(result)
        } else if let result = try? decoder.container(keyedBy: DynamicCodingKey.self) {
            var object: [String: JarvisSettingsValue] = [:]
            for key in result.allKeys {
                object[key.stringValue] = try result.decode(JarvisSettingsValue.self, forKey: key)
            }
            self = .object(object)
        } else if var result = try? decoder.unkeyedContainer() {
            var array: [JarvisSettingsValue] = []
            while !result.isAtEnd {
                array.append(try result.decode(JarvisSettingsValue.self))
            }
            self = .array(array)
        } else {
            throw DecodingError.dataCorruptedError(in: value, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .object(let values):
            var container = encoder.container(keyedBy: DynamicCodingKey.self)
            for (key, value) in values {
                try container.encode(value, forKey: DynamicCodingKey(stringValue: key)!)
            }
        case .array(let values):
            var container = encoder.unkeyedContainer()
            for value in values { try container.encode(value) }
        case .string(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .integer(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .number(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .boolean(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .null:
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        }
    }

    public subscript(_ key: String) -> JarvisSettingsValue? {
        guard case .object(let values) = self else { return nil }
        return values[key]
    }

    public var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    public var booleanValue: Bool? {
        guard case .boolean(let value) = self else { return nil }
        return value
    }

    public var integerValue: Int? {
        switch self {
        case .integer(let value): value
        case .number(let value) where value.isFinite && value.rounded() == value: Int(exactly: value)
        default: nil
        }
    }
}

private struct DynamicCodingKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

public struct JarvisSettingsResponse: Codable, Equatable, Sendable {
    public let settings: JarvisSettingsValue
    public let options: JarvisSettingsValue
    public let credentials: [JarvisCredential]

    public init(settings: JarvisSettingsValue, options: JarvisSettingsValue, credentials: [JarvisCredential]) {
        self.settings = settings
        self.options = options
        self.credentials = credentials
    }

    public func value(area: String, key: String) -> JarvisSettingsValue? {
        settings[area]?[key]
    }

    public func string(area: String, key: String) -> String? {
        value(area: area, key: key)?.stringValue
    }

    public func boolean(area: String, key: String) -> Bool? {
        value(area: area, key: key)?.booleanValue
    }
}

public struct JarvisCredential: Codable, Equatable, Sendable, Identifiable {
    public let name: String
    public let status: String
    public let expiresAt: String?
    public let lastRenewedAt: String?

    public var id: String { name }
}

public struct JarvisSettingsPatch: Codable, Equatable, Sendable {
    public let areas: [String: [String: JarvisSettingsValue]]

    public init(area: String, key: String, value: JarvisSettingsValue) {
        areas = [area: [key: value]]
    }

    public init(role: String, values: [String: JarvisSettingsValue]) {
        areas = ["roles": [role: .object(values)]]
    }

    public init(areas: [String: [String: JarvisSettingsValue]]) {
        self.areas = areas
    }

    private enum CodingKeys: String, CodingKey {
        case areas = "settings"
    }
}

public struct JarvisModelCatalogue: Codable, Equatable, Sendable {
    public let source: String
    public let deployments: [JarvisModelDeployment]
    public let reason: String?
}

public struct JarvisModelDeployment: Codable, Equatable, Sendable, Identifiable {
    public let name: String
    public let model: String
    public let version: String
    public let sku: String
    public let capacity: Int
    public let capabilities: [String]
    public let reasoningEfforts: [String]

    public var id: String { name }
}

public struct JarvisDeploymentRequest: Codable, Equatable, Sendable {
    public let status: String
    public let name: String
}

public struct JarvisTargetBound: Codable, Equatable, Sendable {
    public let label: String
    public let unit: String
    public let min: Int
    public let max: Int
}

public struct JarvisTargetValues: Codable, Equatable, Sendable {
    public let targets: [String: Int?]
    public let bounds: [String: JarvisTargetBound]
    public let missing: [String]?
    public let updatedAt: String?
}

public struct JarvisHealthUploadCredential: Codable, Equatable, Sendable {
    public let state: String
    public let expiresAt: String?
}

public struct JarvisProactiveSettings: Codable, Equatable, Sendable {
    public let paused: Bool
    public let revision: String
}

public struct JarvisMemoryItem: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: String
    public let title: String
    public let folder: String
    public let text: String
    public let updatedAt: String?

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKey.self)
        let rawID = try container.decode(JarvisSettingsValue.self, forKey: DynamicCodingKey(stringValue: "id")!)
        switch rawID {
        case .string(let value): id = value
        case .integer(let value): id = String(value)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: DynamicCodingKey(stringValue: "id")!,
                in: container,
                debugDescription: "Invalid memory identifier"
            )
        }
        let type = try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "type")!) ?? "memory"
        kind = type
        let content = try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "content")!)
            ?? container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "snippet")!)
            ?? ""
        text = String(content.prefix(20_000))
        folder = String((try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "folder")!) ?? "General").prefix(40))
        let fallbackTitle = try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "key")!)
            ?? container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "path")!)
            ?? String(text.prefix(80))
        title = String((try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "title")!) ?? fallbackTitle).prefix(200))
        updatedAt = try container.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "updatedAt")!)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        try container.encode(id, forKey: DynamicCodingKey(stringValue: "id")!)
        try container.encode(kind, forKey: DynamicCodingKey(stringValue: "type")!)
        try container.encode(title, forKey: DynamicCodingKey(stringValue: "title")!)
        try container.encode(folder, forKey: DynamicCodingKey(stringValue: "folder")!)
        try container.encode(text, forKey: DynamicCodingKey(stringValue: "content")!)
        try container.encodeIfPresent(updatedAt, forKey: DynamicCodingKey(stringValue: "updatedAt")!)
    }
}

public struct JarvisMemoryPage: Codable, Equatable, Sendable {
    public let items: [JarvisMemoryItem]
    public let count: Int
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
}

public struct JarvisRoutine: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: String
    public let key: String
    public let goal: String

    public var title: String { "\(kind): \(key)" }
}

public struct JarvisOwnerProfile: Codable, Equatable, Sendable {
    public let name: String
}

public enum JarvisSettingsClientError: Error, Equatable, Sendable {
    case signInRequired
    case notOwner
    case unavailable
    case offline
    case notFound
    case conflict
    case invalidRequest
    case invalidResponse
    case httpStatus(Int)
}

public struct JarvisSettingsClient: Sendable {
    private let client: JarvisClient

    public init(client: JarvisClient) {
        self.client = client
    }

    public func loadSettings() async throws -> JarvisSettingsResponse {
        try await send(.get, path: ["settings"], idempotent: true)
    }

    public func saveSettings(_ patch: JarvisSettingsPatch) async throws -> JarvisSettingsResponse {
        let body = try JSONEncoder().encode(patch)
        return try await send(.patch, path: ["settings"], body: body)
    }

    public func loadModels() async throws -> JarvisModelCatalogue {
        try await send(.get, path: ["models"], idempotent: true)
    }

    public func requestDeployment(model: String, version: String, sku: String, capacity: Int) async throws -> JarvisDeploymentRequest {
        guard JarvisSettingsLogic.validDeploymentInput(model: model, version: version, sku: sku, capacity: capacity) else {
            throw JarvisSettingsClientError.invalidRequest
        }
        let body = try JSONEncoder().encode(DeploymentBody(model: model, version: version, sku: sku, capacity: capacity))
        return try await send(.post, path: ["models", "deployments"], body: body)
    }

    public func removeDeployment(named name: String) async throws -> JarvisDeploymentRequest {
        guard JarvisSettingsLogic.validDeploymentName(name) else { throw JarvisSettingsClientError.invalidRequest }
        return try await send(.delete, path: ["models", "deployments", name])
    }

    public func renewCredential(named name: String) async throws -> JarvisCredential {
        guard JarvisSettingsLogic.validCredentialName(name) else { throw JarvisSettingsClientError.invalidRequest }
        let response: CredentialResponse = try await send(.post, path: ["settings", "credentials", name, "renew"])
        return response.credential
    }

    public func loadTrainingTargets() async throws -> JarvisTargetValues {
        try await send(.get, path: ["daily", "training-targets"], idempotent: true)
    }

    public func saveTrainingTargets(_ changes: [String: Int?]) async throws -> JarvisTargetValues {
        try JarvisSettingsLogic.validateTargets(changes, keys: ["gymSessionsPerWeek", "runSessionsPerWeek", "dailySteps"])
        let body = try JSONEncoder().encode(TargetPatch(values: changes))
        return try await send(.patch, path: ["daily", "training-targets"], body: body)
    }

    public func loadNutritionTargets() async throws -> JarvisTargetValues {
        try await send(.get, path: ["daily", "nutrition-targets"], idempotent: true)
    }

    public func saveNutritionTargets(_ changes: [String: Int?]) async throws -> JarvisTargetValues {
        try JarvisSettingsLogic.validateTargets(changes, keys: ["restingKcal", "deficitKcal", "proteinGrams"])
        let body = try JSONEncoder().encode(TargetPatch(values: changes))
        return try await send(.patch, path: ["daily", "nutrition-targets"], body: body)
    }

    public func loadHealthUploadCredential() async throws -> JarvisHealthUploadCredential {
        try await send(.get, path: ["api", "health", "upload-credential"], idempotent: true)
    }

    public func loadProactiveSettings() async throws -> JarvisProactiveSettings {
        try await send(.get, path: ["proactive", "settings"], idempotent: true)
    }

    public func saveProactivePaused(_ paused: Bool, expectedRevision: String) async throws -> JarvisProactiveSettings {
        guard JarvisSettingsLogic.validRevision(expectedRevision) else { throw JarvisSettingsClientError.invalidRequest }
        let body = try JSONEncoder().encode(ProactivePatch(paused: paused, expectedRevision: expectedRevision))
        return try await send(.patch, path: ["proactive", "settings"], body: body)
    }

    public func loadMemory(query: String = "", offset: Int = 0, limit: Int = JarvisSettingsLogic.memoryPageSize) async throws -> JarvisMemoryPage {
        guard JarvisSettingsLogic.validMemoryPage(offset: offset, limit: limit),
              query.utf8.count <= JarvisSettingsLogic.maximumMemoryQueryBytes else {
            throw JarvisSettingsClientError.invalidRequest
        }
        var items = [
            URLQueryItem(name: "folder", value: "General"),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if !query.isEmpty { items.append(URLQueryItem(name: "query", value: query)) }
        let page: JarvisMemoryPage = try await send(
            .get, path: ["memory"], queryItems: items, idempotent: true
        )
        guard page.items.allSatisfy({ $0.kind == "memory" }) else {
            throw JarvisSettingsClientError.invalidResponse
        }
        return page
    }

    public func readMemory(id: String) async throws -> JarvisMemoryItem {
        guard JarvisSettingsLogic.validMemoryID(id) else { throw JarvisSettingsClientError.invalidRequest }
        return try await send(.get, path: ["memory", id], idempotent: true)
    }

    public func updateMemory(id: String, text: String) async throws {
        guard JarvisSettingsLogic.validMemoryID(id),
              JarvisSettingsLogic.validMemoryText(text) else {
            throw JarvisSettingsClientError.invalidRequest
        }
        let body = try JSONEncoder().encode(MemoryPatch(text: text))
        try await sendNoContent(.patch, path: ["memory", id], body: body)
    }

    public func deleteMemory(id: String) async throws -> Bool {
        guard JarvisSettingsLogic.validMemoryID(id) else { throw JarvisSettingsClientError.invalidRequest }
        let response = try await perform(.delete, path: ["memory", id], idempotent: false)
        return response.statusCode == 202
    }

    public func loadRoutines() async throws -> [JarvisRoutine] {
        let response: RoutineResponse = try await send(.get, path: ["routines"], idempotent: true)
        guard response.routines.count <= 100,
              Set(response.routines.map(\.id)).count == response.routines.count else {
            throw JarvisSettingsClientError.invalidResponse
        }
        return response.routines
    }

    public func deleteRoutine(id: String) async throws {
        guard JarvisSettingsLogic.validRoutineID(id) else { throw JarvisSettingsClientError.invalidRequest }
        try await sendNoContent(.delete, path: ["routines", id])
    }

    public func loadOwnerProfile() async throws -> JarvisOwnerProfile {
        try await send(.get, path: ["me"], idempotent: true)
    }

    public func signOut() async throws {
        do {
            try await client.revokeCurrentSession()
        } catch {
            throw Self.map(error)
        }
    }

    public func signOutAllDevices() async throws {
        do {
            _ = try await client.revokeAllSessions()
        } catch {
            throw Self.map(error)
        }
    }

    private func send<Response: Decodable>(
        _ method: HTTPMethod,
        path: [String],
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        idempotent: Bool = false
    ) async throws -> Response {
        let response = try await perform(
            method, path: path, queryItems: queryItems, body: body, idempotent: idempotent
        )
        do {
            return try JSONDecoder().decode(Response.self, from: response.body)
        } catch {
            throw JarvisSettingsClientError.invalidResponse
        }
    }

    private func sendNoContent(
        _ method: HTTPMethod,
        path: [String],
        body: Data? = nil
    ) async throws {
        _ = try await perform(method, path: path, body: body, idempotent: false)
    }

    private func perform(
        _ method: HTTPMethod,
        path: [String],
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        idempotent: Bool
    ) async throws -> HTTPResponse {
        do {
            return try await client.performAuthenticatedRequest(
                method: method,
                path: path,
                queryItems: queryItems,
                body: body,
                idempotent: idempotent,
                additionalSuccessStatuses: [202, 204]
            )
        } catch {
            throw Self.map(error)
        }
    }

    private static func map(_ error: Error) -> JarvisSettingsClientError {
        guard let error = error as? JarvisClientError else { return .offline }
        switch error {
        case .signInRequired: return .signInRequired
        case .notOwner: return .notOwner
        case .serviceUnavailable: return .unavailable
        case .networkFailure, .timedOut: return .offline
        case .httpStatus(404): return .notFound
        case .httpStatus(409): return .conflict
        case .httpStatus(let status): return .httpStatus(status)
        default: return .invalidResponse
        }
    }
}

private struct DeploymentBody: Encodable {
    let model: String
    let version: String
    let sku: String
    let capacity: Int
}

private struct CredentialResponse: Decodable {
    let credential: JarvisCredential
}

private struct TargetPatch: Encodable {
    let values: [String: Int?]

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        for (key, value) in values {
            try container.encode(value, forKey: DynamicCodingKey(stringValue: key)!)
        }
    }
}

private struct ProactivePatch: Encodable {
    let paused: Bool
    let expectedRevision: String
}

private struct MemoryPatch: Encodable {
    let text: String
}

private struct RoutineResponse: Decodable {
    let routines: [JarvisRoutine]
}

public enum JarvisSettingsLogic {
    public static let memoryPageSize = 50
    public static let maximumMemoryOffset = 10_000
    public static let maximumMemoryQueryBytes = 200
    public static let maximumMemoryTextBytes = 2_000

    public static func filter(
        _ rows: [String],
        labels: [String: String],
        query: String,
        language: JarvisAppLanguage
    ) -> [String] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: language.locale)
        guard !term.isEmpty else { return rows }
        return rows.filter {
            labels[$0]?.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: language.locale)
                .contains(term) == true
        }
    }

    public static func changes(from saved: JarvisSettingsValue, to edited: JarvisSettingsValue) -> JarvisSettingsPatch? {
        guard case .object(let savedAreas) = saved, case .object(let editedAreas) = edited else { return nil }
        var areas: [String: [String: JarvisSettingsValue]] = [:]
        for (area, value) in editedAreas {
            guard case .object(let editedValues) = value else { continue }
            let oldValues: [String: JarvisSettingsValue]
            if case .object(let previous) = savedAreas[area] { oldValues = previous } else { oldValues = [:] }
            for (key, newValue) in editedValues where oldValues[key] != newValue {
                areas[area, default: [:]][key] = newValue
            }
        }
        return areas.isEmpty ? nil : JarvisSettingsPatch(areas: areas)
    }

    public static func validOption(_ value: String, options: [String]) -> Bool {
        options.contains(value)
    }

    public static func validTarget(_ value: Int?, bound: JarvisTargetBound) -> Bool {
        guard let value else { return true }
        return (bound.min...bound.max).contains(value)
    }

    public static func validateTargets(_ values: [String: Int?], keys: Set<String>) throws {
        guard !values.isEmpty,
              values.keys.allSatisfy(keys.contains),
              values.values.allSatisfy({ value in value.map { $0 >= 0 && $0 <= 1_000_000 } ?? true }) else {
            throw JarvisSettingsClientError.invalidRequest
        }
    }

    public static func validDeploymentInput(model: String, version: String, sku: String, capacity: Int) -> Bool {
        model.utf8.count <= 128 && !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            matches(version, pattern: #"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"#) &&
            matches(sku, pattern: #"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"#) &&
            (1...100_000).contains(capacity)
    }

    public static func validDeploymentName(_ name: String) -> Bool {
        matches(name, pattern: #"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"#)
    }

    public static func validCredentialName(_ name: String) -> Bool {
        matches(name, pattern: #"^[a-z0-9][a-z0-9-]{0,63}$"#)
    }

    public static func validMemoryPage(offset: Int, limit: Int) -> Bool {
        (0...maximumMemoryOffset).contains(offset) && (1...memoryPageSize).contains(limit)
    }

    public static func validMemoryID(_ id: String) -> Bool {
        matches(id, pattern: #"^(?:[1-9][0-9]{0,18}|vault_[A-Za-z0-9_-]{1,256})$"#)
    }

    public static func validMemoryText(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            text.utf8.count <= maximumMemoryTextBytes &&
            !text.unicodeScalars.contains(where: { $0.value < 0x20 && $0 != "\n" && $0 != "\r" && $0 != "\t" })
    }

    public static func validRoutineID(_ id: String) -> Bool {
        matches(id, pattern: #"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"#)
    }

    public static func validRevision(_ revision: String) -> Bool {
        matches(revision, pattern: #"^[a-f0-9]{64}$"#)
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
}

public struct JarvisSettingsEditState: Equatable, Sendable {
    public private(set) var saved: JarvisSettingsValue
    public private(set) var value: JarvisSettingsValue

    public init(_ value: JarvisSettingsValue) {
        saved = value
        self.value = value
    }

    public var changes: JarvisSettingsPatch? {
        JarvisSettingsLogic.changes(from: saved, to: value)
    }

    public var isDirty: Bool { changes != nil }

    public mutating func set(_ value: JarvisSettingsValue, area: String, key: String) {
        guard case .object(var areas) = self.value else { return }
        var fields: [String: JarvisSettingsValue]
        if case .object(let current) = areas[area] {
            fields = current
        } else {
            fields = [:]
        }
        fields[key] = value
        areas[area] = .object(fields)
        self.value = .object(areas)
    }

    public mutating func markSaved(_ value: JarvisSettingsValue) {
        saved = value
        self.value = value
    }
}
