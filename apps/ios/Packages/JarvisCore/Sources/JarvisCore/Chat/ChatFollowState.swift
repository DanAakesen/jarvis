public struct ChatFollowState: Equatable, Sendable {
    public enum Phase: Sendable {
        case tracking, dragging, coasting, programmatic, idle
    }

    public struct Viewport: Equatable, Sendable {
        let offset: Double
        let top: Double
        let bottom: Double

        public init(offset: Double, top: Double, bottom: Double) {
            self.offset = offset
            self.top = top
            self.bottom = max(top, bottom)
        }

        var visibleOffset: Double { min(max(offset, top), bottom) }
        var distanceFromBottom: Double { bottom - visibleOffset }
    }

    private enum Gesture: Equatable, Sendable { case none, touch, scroll }

    public private(set) var isFollowing = true
    public private(set) var hasNewMessages = false
    private var gesture = Gesture.none
    private var selectedMessages: Set<String> = []

    public init() {}

    public var shouldFollow: Bool {
        isFollowing && gesture == .none && selectedMessages.isEmpty
    }

    public var shouldShowJumpToLatest: Bool {
        hasNewMessages && (!isFollowing || !selectedMessages.isEmpty)
    }

    @discardableResult
    public mutating func scrollPhaseChanged(_ phase: Phase) -> Bool {
        switch phase {
        case .tracking:
            gesture = .touch
        case .dragging:
            gesture = .scroll
        case .coasting:
            if gesture != .scroll { gesture = .none }
        case .programmatic:
            gesture = .none
        case .idle:
            let hadGesture = gesture != .none
            gesture = .none
            if shouldFollow { hasNewMessages = false }
            return hadGesture && shouldFollow
        }
        return false
    }

    public mutating func viewportChanged(from old: Viewport, to new: Viewport) -> Bool {
        if old.top != new.top || old.bottom != new.bottom {
            // Layout can move the bottom without the reader moving at all. Follow after layout, not before it.
            return shouldFollow && new.distanceFromBottom > 1
        }
        if gesture == .scroll {
            if new.visibleOffset < old.visibleOffset && new.distanceFromBottom > 44 {
                isFollowing = false
            } else if new.visibleOffset > old.visibleOffset && new.distanceFromBottom <= 44 {
                isFollowing = true
                hasNewMessages = false
            }
        }
        return false
    }

    @discardableResult
    public mutating func messageArrived() -> Bool {
        hasNewMessages = !shouldFollow
        return shouldFollow
    }

    public mutating func messageSent() {
        isFollowing = true
        gesture = .none
        hasNewMessages = false
        selectedMessages.removeAll()
    }

    public mutating func jumpedToLatest() {
        messageSent()
    }

    public mutating func notificationMessageOpened() {
        isFollowing = false
        gesture = .none
        hasNewMessages = true
        selectedMessages.removeAll()
    }

    /// The keyboard came up under the composer: the owner is writing, so the latest message must stay in view.
    public mutating func keyboardOpened() {
        messageSent()
    }

    public mutating func selectionChanged(messageID: String, isSelected: Bool) {
        if isSelected {
            selectedMessages.insert(messageID)
        } else {
            selectedMessages.remove(messageID)
            if shouldFollow { hasNewMessages = false }
        }
    }
}
