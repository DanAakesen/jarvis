import Foundation
import XCTest
@testable import JarvisCore

final class JarvisBackgroundRefreshTests: XCTestCase {
    @MainActor
    func testSuccessCompletesExactlyOnceAndCannotRestart() async {
        let results = AsyncStream<Bool>.makeStream()
        var completions: [Bool] = []
        var calls = 0
        let refresh = JarvisBackgroundRefresh {
            completions.append($0)
            results.continuation.yield($0)
        }
        refresh.start(timeout: .seconds(60)) { calls += 1 }
        refresh.start(timeout: .seconds(60)) { calls += 1 }
        var iterator = results.stream.makeAsyncIterator()
        let result = await iterator.next()
        XCTAssertEqual(result, true)
        refresh.cancel()
        refresh.cancel()
        refresh.start(timeout: .seconds(60)) { calls += 1 }
        XCTAssertEqual(completions, [true])
        XCTAssertEqual(calls, 1)
    }

    @MainActor
    func testFailureCompletesExactlyOnce() async {
        let results = AsyncStream<Bool>.makeStream()
        var completions: [Bool] = []
        let refresh = JarvisBackgroundRefresh {
            completions.append($0)
            results.continuation.yield($0)
        }
        refresh.start(timeout: .seconds(60)) { throw JarvisClientError.networkFailure }
        var iterator = results.stream.makeAsyncIterator()
        let result = await iterator.next()
        XCTAssertEqual(result, false)
        refresh.cancel()
        XCTAssertEqual(completions, [false])
    }

    @MainActor
    func testExpirationCancelsWorkAndCompletesOnlyOnce() async {
        let started = AsyncStream<Void>.makeStream()
        let cancelled = AsyncStream<Void>.makeStream()
        var completions: [Bool] = []
        let refresh = JarvisBackgroundRefresh { completions.append($0) }
        refresh.start(timeout: .seconds(60)) {
            started.continuation.yield(())
            do {
                try await Task.sleep(for: .seconds(60))
            } catch {
                cancelled.continuation.yield(())
                throw error
            }
        }
        var startIterator = started.stream.makeAsyncIterator()
        _ = await startIterator.next()
        refresh.cancel()
        refresh.cancel()
        var cancelIterator = cancelled.stream.makeAsyncIterator()
        _ = await cancelIterator.next()
        XCTAssertEqual(completions, [false])
    }

    @MainActor
    func testLateSuccessAfterExpirationCannotReplaceFailure() async {
        let started = AsyncStream<Void>.makeStream()
        let release = AsyncStream<Void>.makeStream()
        let returned = AsyncStream<Void>.makeStream()
        var completions: [Bool] = []
        let refresh = JarvisBackgroundRefresh { completions.append($0) }
        refresh.start(timeout: .seconds(60)) {
            started.continuation.yield(())
            var iterator = release.stream.makeAsyncIterator()
            _ = await iterator.next()
            returned.continuation.yield(())
        }
        var startIterator = started.stream.makeAsyncIterator()
        _ = await startIterator.next()
        refresh.cancel()
        release.continuation.yield(())
        var returnIterator = returned.stream.makeAsyncIterator()
        _ = await returnIterator.next()
        XCTAssertEqual(completions, [false])
    }

    @MainActor
    func testDeadlineCancelsWork() async {
        let results = AsyncStream<Bool>.makeStream()
        let refresh = JarvisBackgroundRefresh { results.continuation.yield($0) }
        refresh.start(timeout: .zero) { try await Task.sleep(for: .seconds(60)) }
        var iterator = results.stream.makeAsyncIterator()
        let result = await iterator.next()
        XCTAssertEqual(result, false)
    }

    @MainActor
    func testExpirationBeforeStartDoesNotRunWork() {
        var completions: [Bool] = []
        var called = false
        let refresh = JarvisBackgroundRefresh { completions.append($0) }
        refresh.cancel()
        refresh.start(timeout: .seconds(60)) { called = true }
        XCTAssertEqual(completions, [false])
        XCTAssertFalse(called)
    }

    func testAppRegistersAtLaunchSchedulesAndUsesBoundedNoninteractiveTransport() throws {
        let app = try source("apps/ios/Jarvis/JarvisApp.swift")
        let coordinator = try source("apps/ios/Jarvis/JarvisTaskActivityBackgroundRefresh.swift")
        let gate = try source("apps/ios/Jarvis/JarvisGateRootView.swift")
        XCTAssertTrue(app.contains("@UIApplicationDelegateAdaptor(JarvisAppDelegate.self)"))
        XCTAssertTrue(coordinator.contains("didFinishLaunchingWithOptions"))
        XCTAssertTrue(coordinator.contains("JarvisTaskActivityBackgroundRefresh.shared.register()"))
        XCTAssertTrue(coordinator.contains("BGTaskScheduler.shared.register("))
        XCTAssertTrue(coordinator.contains("BGAppRefreshTaskRequest(identifier: Self.identifier)"))
        XCTAssertTrue(coordinator.contains("private func handle(_ task: BGTask) {\n        schedule()"))
        XCTAssertTrue(coordinator.contains("task.expirationHandler = {"))
        XCTAssertTrue(coordinator.contains("refresh.cancel()"))
        XCTAssertEqual(coordinator.components(separatedBy: "task.setTaskCompleted(").count - 1, 1)
        XCTAssertTrue(coordinator.contains("refresh.start(timeout: .seconds(20))"))
        XCTAssertTrue(coordinator.contains("requestTimeout: .seconds(5)"))
        XCTAssertTrue(coordinator.contains("RetryPolicy(maximumRetries: 0)"))
        XCTAssertTrue(coordinator.contains("JarvisBackgroundAccessTokenProvider()"))
        XCTAssertFalse(coordinator.contains("MicrosoftAccessTokenProvider"))
        XCTAssertFalse(coordinator.contains("URLSessionConfiguration.background"))
        XCTAssertFalse(coordinator.contains(".stream("))
        let background = try XCTUnwrap(gate.components(separatedBy: "case .background:").last?
            .components(separatedBy: "case .active:").first)
        XCTAssertTrue(background.contains("JarvisTaskActivityBackgroundRefresh.shared.schedule()"))

        let plist = try Data(contentsOf: repository.appendingPathComponent("apps/ios/Jarvis/Info.plist"))
        let metadata = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any]
        )
        let identifier = "com.danaakesen.jarvis.task-activity-refresh"
        XCTAssertEqual(metadata["BGTaskSchedulerPermittedIdentifiers"] as? [String], [identifier])
        XCTAssertTrue(coordinator.contains("static let identifier = \"\(identifier)\""))
        XCTAssertTrue((metadata["UIBackgroundModes"] as? [String] ?? []).contains("fetch"))
        XCTAssertTrue((metadata["UIBackgroundModes"] as? [String] ?? []).contains("audio"))
    }

    func testBackgroundReconciliationOnlyReadsServerTruthAndNeverCreatesActivities() throws {
        let controller = try source("apps/ios/Jarvis/JarvisFactoryLiveActivityController.swift")
        let refresh = try XCTUnwrap(controller.components(separatedBy: "static func refreshExisting(").last?
            .components(separatedBy: "static func synchronize(").first)
        XCTAssertTrue(refresh.contains(".activities.prefix(maximumConcurrentActivities)"))
        XCTAssertTrue(refresh.contains("guard !activities.isEmpty else { return }"))
        XCTAssertTrue(refresh.contains("async let feed = nowClient.load()"))
        XCTAssertTrue(refresh.contains("async let jobs = nowClient.backgroundTasks()"))
        XCTAssertTrue(refresh.contains("factoryClient.task(id: id, eventLimit: 1)"))
        XCTAssertTrue(refresh.contains("reconciliationOnly: true"))
        XCTAssertTrue(refresh.contains("try Task.checkCancellation()"))
        XCTAssertFalse(refresh.contains("Activity.request"))
        XCTAssertFalse(refresh.contains("registerTaskActivity"))
        XCTAssertFalse(refresh.contains("synchronize("))
        XCTAssertFalse(refresh.contains("runTool"))
        XCTAssertFalse(refresh.contains("createTurn"))
        let guardRange = try XCTUnwrap(controller.range(of: "guard !reconciliationOnly else { return }"))
        let requestRange = try XCTUnwrap(controller.range(of: "let activity = try Activity.request("))
        XCTAssertLessThan(guardRange.lowerBound, requestRange.lowerBound)
        XCTAssertTrue(controller.contains("if !reconciliationOnly {\n                observePushToken"))
        XCTAssertTrue(try source("apps/ios/Jarvis/KeychainTokenStore.swift")
            .contains("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly"))
    }

    private var repository: URL {
        var result = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { result.deleteLastPathComponent() }
        return result
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: repository.appendingPathComponent(path), encoding: .utf8)
    }
}
