public struct ChatHistoryPagingState: Equatable, Sendable {
    public private(set) var nextCursor: String?
    private var didLoadOlderPage = false

    public init() {}

    public mutating func replaceHistory(nextCursor: String?) {
        self.nextCursor = nextCursor
        didLoadOlderPage = false
    }

    public mutating func appendOlderPage(nextCursor: String?) {
        self.nextCursor = nextCursor
        didLoadOlderPage = true
    }

    public mutating func refreshLatestPage(nextCursor: String?) {
        if !didLoadOlderPage {
            self.nextCursor = nextCursor
        }
    }
}
