import SwiftUI
import JarvisCore

/// Compact tool-activity rows: a tool-specific icon, the action label and, for groups, a chevron right after the label.
/// States come from real tool events only. Running traces a highlight around the icon outline and shimmers the action
/// text; success turns the icon orange; failure and refusal never use orange. Motion is derived from the clock, so a
/// state change stops it at once, and Reduce Motion shows the same rows without any movement.
enum JarvisToolActivityMotion {
    static let loop: TimeInterval = 1.4

    static func phase(at date: Date) -> Double {
        date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: loop) / loop
    }
}

extension ChatToolKind {
    var symbolName: String {
        switch self {
        case .read: "doc.text"
        case .edit: "pencil"
        case .command: "terminal"
        case .web: "globe"
        case .configuration: "gearshape"
        case .deployment: "cloud"
        case .generic: "wrench.and.screwdriver"
        }
    }
}

extension ChatToolStatus {
    var iconColor: Color {
        switch self {
        case .running: .primary
        case .succeeded: JarvisDesignTokens.primaryAccent
        case .failed: .red
        case .refused: .secondary
        }
    }
}

struct JarvisToolActivityIcon: View {
    let kind: ChatToolKind
    let status: ChatToolStatus
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var width: CGFloat = 18

    var body: some View {
        Group {
            if status == .running, !reduceMotion {
                TimelineView(.animation) { context in
                    glyph(color: Color.primary.opacity(0.6))
                        .overlay {
                            glyph(color: .primary)
                                .mask { trace(phase: JarvisToolActivityMotion.phase(at: context.date)) }
                        }
                }
            } else {
                glyph(color: status == .running ? Color.primary.opacity(0.85) : status.iconColor)
            }
        }
        .frame(width: width)
        .accessibilityHidden(true)
    }

    private func glyph(color: Color) -> some View {
        Image(systemName: kind.symbolName)
            .font(.caption)
            .foregroundStyle(color)
            .frame(width: width)
    }

    /// A short bright arc that sweeps clockwise around the glyph; the glyph itself never moves or changes size.
    private func trace(phase: Double) -> some View {
        AngularGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .clear, location: 0.7),
                .init(color: .white, location: 0.95),
                .init(color: .clear, location: 1)
            ],
            center: .center,
            angle: .degrees(phase * 360)
        )
    }
}

/// Action text. While running, a brighter band travels across the text only (the icon and chevron are not part of it).
struct JarvisToolActivityLabel: View {
    let title: String
    let status: ChatToolStatus
    let statusText: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if status == .running, !reduceMotion {
                TimelineView(.animation) { context in
                    label(color: Color.primary.opacity(0.7))
                        .overlay {
                            label(color: .primary)
                                .mask { band(phase: JarvisToolActivityMotion.phase(at: context.date)) }
                        }
                }
            } else {
                label(color: status == .running ? Color.primary.opacity(0.85) : Color.primary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func label(color: Color) -> Text {
        let action = Text(status == .running ? title + "…" : title).foregroundStyle(color)
        guard let statusText else { return action }
        let detail = Text(" · \(statusText)").foregroundStyle(Color.secondary)
        return Text("\(action)\(detail)")
    }

    private func band(phase: Double) -> some View {
        let center = -0.25 + phase * 1.5
        func clamped(_ value: Double) -> Double { min(max(value, 0), 1) }
        return LinearGradient(
            stops: [
                .init(color: .clear, location: clamped(center - 0.25)),
                .init(color: .white, location: clamped(center)),
                .init(color: .clear, location: clamped(center + 0.25))
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }
}

/// One tool row. `isExpanded` is nil for a call without children, so no chevron is drawn.
struct JarvisToolActivityRow: View {
    let kind: ChatToolKind
    let status: ChatToolStatus
    let title: String
    let statusText: String?
    var isExpanded: Bool?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: JarvisDesignTokens.iconLabelSpacing) {
            JarvisToolActivityIcon(kind: kind, status: status)
            JarvisToolActivityLabel(title: title, status: status, statusText: statusText)
            if let isExpanded {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Spacer(minLength: 0)
        }
        .font(.caption)
    }
}
