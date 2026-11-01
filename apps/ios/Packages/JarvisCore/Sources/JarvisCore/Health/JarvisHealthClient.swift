import Foundation

public enum JarvisHealthSource: String, CaseIterable, Codable, Sendable {
    case metrics = "daily.health.metrics"
    case sleep = "daily.health.sleep"
    case workouts = "daily.health.workouts"
    case workout = "daily.health.workout"
    case heartRate = "daily.health.heart-rate"
    case metricCatalog = "daily.health.metric-catalog"
    case nutritionDays = "daily.nutrition.days"
    case meals = "daily.nutrition.meals"
    case sync = "daily.sync"
    case lifts = "daily.health.lifts"
}

public struct JarvisHealthCapabilities: Decodable, Equatable, Sendable {
    public let version: Int
    public let sources: [String]

    public var availableSources: Set<String> { Set(sources) }
}

public struct JarvisHealthQuery: Encodable, Sendable {
    public let source: JarvisHealthSource
    public let startDate: String?
    public let endDate: String?
    public let metric: String?
    public let workoutId: String?
    public let limit: Int?
    public let cursor: JSONValue?
    public let lastPerExercise: Bool?

    public init(
        source: JarvisHealthSource,
        period: JarvisHealthPeriod? = nil,
        metric: String? = nil,
        workoutId: String? = nil,
        limit: Int? = nil,
        cursor: JSONValue? = nil,
        lastPerExercise: Bool? = nil
    ) throws {
        let periodlessSource = source == .sync || source == .workout || source == .heartRate || source == .lifts
        guard (period == nil) == periodlessSource,
              source == .metrics || source == .heartRate || metric == nil,
              (source == .workout || source == .heartRate) || workoutId == nil,
              (source == .workout || source == .heartRate) == (workoutId != nil),
              source == .lifts || lastPerExercise == nil,
              limit.map({ (1...(source == .lifts ? 100 : 500)).contains($0) }) ?? true else {
            throw JarvisClientError.invalidRequest
        }
        self.source = source
        startDate = period?.startDate
        endDate = period?.endDate
        self.metric = metric
        self.workoutId = workoutId
        self.limit = limit
        self.cursor = cursor
        self.lastPerExercise = lastPerExercise
    }

    func page(after cursor: JSONValue?) throws -> JarvisHealthQuery {
        try JarvisHealthQuery(
            source: source,
            period: startDate.flatMap { start in endDate.flatMap { JarvisHealthPeriod(startDate: start, endDate: $0) } },
            metric: metric,
            workoutId: workoutId,
            limit: limit,
            cursor: cursor,
            lastPerExercise: lastPerExercise
        )
    }
}

public struct JarvisHealthCoverage: Decodable, Sendable {
    public let returned: Int
    public let hasMore: Bool
    public let next: JSONValue?
}

public struct JarvisHealthQueryResult: Decodable, Sendable {
    public let source: String
    public let items: [[String: JSONValue]]
    public let status: String
    public let freshness: [String: JSONValue]?
    public let coverage: JarvisHealthCoverage
}

public struct JarvisHealthTargets: Decodable, Equatable, Sendable {
    public let targets: Values

    public struct Values: Decodable, Equatable, Sendable {
        public let gymSessionsPerWeek: Double?
        public let runSessionsPerWeek: Double?
        public let dailySteps: Double?
    }
}

public struct JarvisNutritionTargets: Decodable, Equatable, Sendable {
    public let targets: Values

    public struct Values: Decodable, Equatable, Sendable {
        public let restingKcal: Double?
        public let deficitKcal: Double?
        public let proteinGrams: Double?
    }
}

public enum JarvisHealthClientError: Error, Equatable, Sendable {
    case invalidResponse
    case responseTooLarge
    case invalidStream
}

public final class JarvisHealthClient: Sendable {
    private let client: JarvisClient
    private static let responseLimit = 1024 * 1024

    public init(client: JarvisClient) {
        self.client = client
    }

    public func capabilities() async throws -> JarvisHealthCapabilities {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["daily", "capabilities"],
            idempotent: true,
            accept: "application/json;version=6"
        )
        guard response.statusCode == 200,
              response.body.count <= Self.responseLimit,
              let value = try? JSONDecoder().decode(CapabilityEnvelope.self, from: response.body),
              value.module == "daily", (1...6).contains(value.version),
              !value.sources.isEmpty, value.sources.count <= 64,
              Set(value.sources).count == value.sources.count else {
            throw JarvisHealthClientError.invalidResponse
        }
        return JarvisHealthCapabilities(version: value.version, sources: value.sources)
    }

    public func trainingTargets() async throws -> JarvisHealthTargets {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["daily", "training-targets"],
            idempotent: true
        )
        guard response.statusCode == 200 else { throw JarvisHealthClientError.invalidResponse }
        return try decode(response.body)
    }

    public func nutritionTargets() async throws -> JarvisNutritionTargets {
        let response = try await client.performAuthenticatedRequest(
            method: .get,
            path: ["daily", "nutrition-targets"],
            idempotent: true
        )
        guard response.statusCode == 200 else { throw JarvisHealthClientError.invalidResponse }
        return try decode(response.body)
    }

    public func createLift(_ draft: JarvisLiftDraft) async throws {
        guard draft.isValid else { throw JarvisClientError.invalidRequest }
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["daily", "lifts"],
            body: try JSONEncoder().encode(draft),
            idempotent: false
        )
        guard response.statusCode == 200 || response.statusCode == 201 else {
            throw JarvisHealthClientError.invalidResponse
        }
        let result: LiftEnvelope = try decode(response.body)
        guard UUID(uuidString: result.entry.id) != nil else {
            throw JarvisHealthClientError.invalidResponse
        }
    }

    private struct LiftEnvelope: Decodable {
        let entry: Entry
        struct Entry: Decodable { let id: String }
    }

    public func query(_ query: JarvisHealthQuery) async throws -> JarvisHealthQueryResult {
        let body: Data
        do {
            body = try JSONEncoder().encode(query)
        } catch {
            throw JarvisClientError.responseEncodingFailure
        }
        let response = try await client.performAuthenticatedRequest(
            method: .post,
            path: ["daily", "query"],
            body: body,
            idempotent: true
        )
        guard response.statusCode == 200 else { throw JarvisHealthClientError.invalidResponse }
        let result: JarvisHealthQueryResult = try decode(response.body)
        guard result.source == query.source.rawValue,
              result.items.count <= (query.limit ?? 1),
              result.coverage.returned == result.items.count,
              result.coverage.hasMore == (result.coverage.next != nil) else {
            throw JarvisHealthClientError.invalidResponse
        }
        return result
    }

    public func queryAll(
        _ query: JarvisHealthQuery,
        maximumPages: Int = 5
    ) async throws -> JarvisHealthQueryResult {
        guard (1...5).contains(maximumPages) else { throw JarvisClientError.invalidRequest }
        var pageQuery = query
        var items: [[String: JSONValue]] = []
        var lastPage: JarvisHealthQueryResult?
        for _ in 0..<maximumPages {
            let page = try await self.query(pageQuery)
            items.append(contentsOf: page.items)
            lastPage = page
            guard page.coverage.hasMore else { break }
            pageQuery = try pageQuery.page(after: page.coverage.next)
        }
        guard let lastPage else { throw JarvisHealthClientError.invalidResponse }
        return JarvisHealthQueryResult(
            source: lastPage.source,
            items: items,
            status: lastPage.coverage.hasMore ? "partial" : lastPage.status,
            freshness: lastPage.freshness,
            coverage: JarvisHealthCoverage(
                returned: items.count,
                hasMore: lastPage.coverage.hasMore,
                next: lastPage.coverage.next
            )
        )
    }

    public func refreshEvents() -> AsyncThrowingStream<Void, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var retryDelay: Duration = .seconds(1)
                do {
                    while !Task.isCancelled {
                        do {
                            let response = try await client.performChatStream(
                                method: .get,
                                path: ["now", "events"]
                            )
                            guard response.statusCode == 200,
                                  response.header("Content-Type")?.lowercased().contains("text/event-stream") == true else {
                                throw JarvisHealthClientError.invalidStream
                            }
                            retryDelay = .seconds(1)
                            var parser = SSEParser()
                            var bytesRead = 0
                            for try await bytes in response.body {
                                try Task.checkCancellation()
                                bytesRead += bytes.count
                                guard bytesRead <= Self.responseLimit else {
                                    throw JarvisHealthClientError.responseTooLarge
                                }
                                for event in parser.append(bytes) {
                                    guard event.data.utf8.count <= 4_096 else {
                                        throw JarvisHealthClientError.invalidStream
                                    }
                                    if event.name == "refresh" || event.name == "now" {
                                        continuation.yield(())
                                    }
                                }
                            }
                            for event in parser.finish() where event.name == "refresh" || event.name == "now" {
                                continuation.yield(())
                            }
                        } catch is CancellationError {
                            throw CancellationError()
                        } catch let error as JarvisClientError {
                            if error == .signInRequired || error == .notOwner ||
                                error == .httpStatus(404) || error == .httpStatus(403) {
                                throw error
                            }
                        } catch let error as JarvisHealthClientError {
                            if error == .invalidStream { throw error }
                        } catch {
                            try Task.checkCancellation()
                        }
                        try await Task.sleep(for: retryDelay)
                        retryDelay = min(retryDelay * 2, .seconds(30))
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func decode<Value: Decodable>(_ data: Data) throws -> Value {
        guard data.count <= Self.responseLimit else {
            throw JarvisHealthClientError.responseTooLarge
        }
        guard let value = try? JSONDecoder().decode(Value.self, from: data) else {
            throw JarvisHealthClientError.invalidResponse
        }
        return value
    }
}

private struct CapabilityEnvelope: Decodable {
    let module: String
    let version: Int
    let sources: [String]
}
