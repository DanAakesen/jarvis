import Foundation

/// The immediate Factory actions a widget button can run. The App Intents call `perform`; the app installs the
/// handler that holds the authenticated clients, so no token ever sits in the shared container.
@MainActor
public enum JarvisFactoryWidgetActions {
    public static var handler: (@MainActor (JarvisFactoryWidgetData.Action, String) async throws -> Void)?

    public enum Failure: Error, Equatable {
        case unavailable
    }

    public static func perform(_ action: JarvisFactoryWidgetData.Action, id: String) async throws {
        guard let handler else { throw Failure.unavailable }
        try await handler(action, id)
    }
}
