public struct PresentedWorkspaceView: Equatable, Identifiable, Sendable {
    public let viewId: String
    public let view: GeneratedView

    public init(viewId: String, view: GeneratedView) {
        self.viewId = viewId
        self.view = view
    }

    public var id: String { viewId }
}

public struct VoiceVisualHistory: Equatable, Sendable {
    public private(set) var entries: [PresentedWorkspaceView] = []
    public private(set) var selectedID: String?

    public init() {}

    public mutating func present(_ visual: PresentedWorkspaceView) {
        if let index = entries.firstIndex(where: { $0.id == visual.id }) {
            entries[index] = visual
        } else {
            entries.append(visual)
        }
        selectedID = visual.id
    }

    public mutating func select(_ id: String) {
        guard entries.contains(where: { $0.id == id }) else { return }
        selectedID = id
    }

    public mutating func dismiss(_ id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries.remove(at: index)
        if selectedID == id {
            selectedID = entries.isEmpty ? nil : entries[min(index, entries.count - 1)].id
        }
    }
}
