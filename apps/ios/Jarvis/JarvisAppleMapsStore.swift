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

    func lookup(lookupId: String, request: AppleMapsRequest) async throws -> (result: AppleMapsResult, status: WorkspaceMapReceipt.Reason?) {
        let current = generation
        let lookup = try await JarvisAppleMaps().lookup(request)
        try Task.checkCancellation()
        guard current == generation else { throw CancellationError() }
        if entries[lookupId] == nil, entries.count >= 8, let oldest = entries.min(by: { $0.value.expiresAt < $1.value.expiresAt }) {
            entries.removeValue(forKey: oldest.key)
        }
        entries[lookupId] = Entry(result: lookup.result, expiresAt: Date().addingTimeInterval(300))
        scheduleExpiry()
        return lookup
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
