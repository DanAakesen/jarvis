import Foundation

public struct PresentedWorkspaceView: Equatable, Identifiable, Sendable {
    public let viewId: String
    public let view: GeneratedView

    public init(viewId: String, view: GeneratedView) {
        self.viewId = viewId
        self.view = view
    }

    public var id: String { viewId }
}

public enum VoiceWindowAction: String, Sendable {
    case previous, next, close
}

public struct VoiceVisualHistory: Equatable, Sendable {
    public private(set) var windows: [PresentedWorkspaceView] = []
    private var closed: Set<String> = []
    public var entries: [PresentedWorkspaceView] { windows.filter { !closed.contains($0.id) } }
    public private(set) var selectedID: String?

    public init() {}

    public mutating func present(_ visual: PresentedWorkspaceView) {
        closed.remove(visual.id)
        if let index = windows.firstIndex(where: { $0.id == visual.id }) {
            windows[index] = visual
        } else {
            windows.append(visual)
        }
        selectedID = visual.id
    }

    public mutating func select(_ id: String) {
        guard entries.contains(where: { $0.id == id }) else { return }
        selectedID = id
    }

    public var selected: PresentedWorkspaceView? {
        entries.first { $0.id == selectedID }
    }

    @discardableResult
    public mutating func apply(_ action: VoiceWindowAction) -> Bool {
        guard let index = entries.firstIndex(where: { $0.id == selectedID }) else { return false }
        switch action {
        case .close:
            dismiss(entries[index].id)
        case .previous, .next:
            let neighbour = index + (action == .previous ? -1 : 1)
            guard entries.indices.contains(neighbour) else { return false }
            selectedID = entries[neighbour].id
        }
        return true
    }

    public mutating func dismissAll() {
        closed = Set(windows.map(\.id))
        selectedID = nil
    }

    public mutating func dismiss(_ id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        closed.insert(id)
        if selectedID == id {
            selectedID = entries.isEmpty ? nil : entries[min(index, entries.count - 1)].id
        }
    }
}
public enum VoiceVerticalSwipe: Equatable, Sendable {
    case up, down

    public init?(translation: CGSize, minimumDistance: CGFloat) {
        let vertical = abs(translation.height)
        guard vertical >= minimumDistance, vertical > abs(translation.width) else { return nil }
        self = translation.height < 0 ? .up : .down
    }
}
