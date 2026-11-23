import Combine
import Foundation
import JarvisCore

@MainActor
final class JarvisAppleMapsStore: ObservableObject {
    static let shared = JarvisAppleMapsStore()
    private struct Entry {
        let result: AppleMapsResult
        let expiresAt: Date
    }
    @Published private var entries: [String: Entry] = [:]
    private var expiry: Task<Void, Never>?
    private var generation = 0

    func result(for lookupId: String) -> AppleMapsResult? {
        guard let entry = entries[lookupId], entry.expiresAt > Date() else { return nil }
        return entry.result
    }

    typealias Lookup = (result: AppleMapsResult, status: WorkspaceMapReceipt.Reason?)

    func resolve(lookupId: String, command: WorkspaceCommand) async throws -> Lookup? {
        if let request = AppleMapsRequest(command: command) {
            return try await lookup(lookupId: lookupId, request: request)
        }
        guard let selection = AppleMapsSelection(command: command) else { return nil }
        guard let prior = entries[selection.lookupId], prior.expiresAt > Date() else { return missingSelection(.expiredLookup) }
        guard let chosen = prior.result.selecting(ordinal: selection.ordinal) else { return missingSelection(.invalidChoice) }
        save(chosen, lookupId: lookupId, expiresAt: prior.expiresAt)
        return (chosen, chosen.reason == nil ? nil : .partial)
    }

    private func missingSelection(_ reason: WorkspaceMapReceipt.Reason) -> Lookup {
        let message = reason == .expiredLookup ? "That list expired. Ask for a fresh search." : "That number was not in the list. Choose one of the listed places."
        return (AppleMapsResult(places: [], mode: "driving", observedAt: Date().ISO8601Format(), reason: message), reason)
    }

    private func lookup(lookupId: String, request: AppleMapsRequest) async throws -> Lookup {
        let current = generation
        let lookup = try await JarvisAppleMaps().lookup(request)
        try Task.checkCancellation()
        guard current == generation else { throw CancellationError() }
        save(lookup.result, lookupId: lookupId)
        return lookup
    }

    private func save(_ result: AppleMapsResult, lookupId: String, expiresAt: Date = Date().addingTimeInterval(300)) {
        if entries[lookupId] == nil, entries.count >= 8, let oldest = entries.min(by: { $0.value.expiresAt < $1.value.expiresAt }) {
            entries.removeValue(forKey: oldest.key)
        }
        entries[lookupId] = Entry(result: result, expiresAt: expiresAt)
        scheduleExpiry()
    }

    func refresh(lookupId: String, request: AppleMapsRequest) async {
        _ = try? await lookup(lookupId: lookupId, request: request)
    }

    func clear() {
        generation += 1
        expiry?.cancel()
        entries.removeAll()
    }

    private func scheduleExpiry() {
        expiry?.cancel()
        guard let next = entries.values.map(\.expiresAt).min() else { return }
        expiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, next.timeIntervalSinceNow))) } catch { return }
            guard let self else { return }
            self.entries = self.entries.filter { $0.value.expiresAt > Date() }
            self.scheduleExpiry()
        }
    }
}
