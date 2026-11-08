import SwiftUI

/// Watch-specific equivalents of the iOS shared controls; UIKit-backed controls cannot link into watchOS.
enum WatchStyle {
    static let amber = Color(red: 1, green: 180 / 255, blue: 92 / 255)
    static let stone = Color(red: 201 / 255, green: 191 / 255, blue: 174 / 255)
    static let surface = Color(white: 0.10)
}
struct WatchSurface: ViewModifier {
    var radius: CGFloat = 22
    func body(content: Content) -> some View {
        content.background {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(LinearGradient(colors: [Color(white: 0.18), .black], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .stroke(LinearGradient(colors: [WatchStyle.amber.opacity(0.65), .white.opacity(0.12), .clear], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.7)
                }
        }
    }
}
struct WatchWave: View {
    var body: some View {
        GeometryReader { proxy in
            let levels: [CGFloat] = [0.08, 0.13, 0.27, 0.55, 0.82, 1, 0.75, 0.48, 0.22, 0.4, 0.28, 0.18, 0.12, 0.08, 0.04]
            HStack(spacing: max(1, proxy.size.width / 55)) {
                ForEach(levels.indices, id: \.self) { i in
                    Capsule().fill(LinearGradient(colors: [WatchStyle.amber, .orange], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(height: max(2, proxy.size.height * levels[i]))
                }
            }.frame(height: proxy.size.height)
        }.accessibilityHidden(true)
    }
}
struct WatchGlyph: View {
    enum Kind { case voice, dictate, tasks, factory }
    var kind: Kind
    var body: some View {
        Group {
            switch kind {
            case .voice: WatchWave()
            case .dictate:
                HStack(spacing: 2) {
                    WatchWave().frame(width: 8, height: 13)
                    Image(systemName: "mic.fill").resizable().scaledToFit()
                    WatchWave().frame(width: 8, height: 13).scaleEffect(x: -1)
                }
            case .tasks: Image(systemName: "checklist").resizable().scaledToFit()
            case .factory: Image(systemName: "chevron.left.forwardslash.chevron.right").resizable().scaledToFit()
            }
        }.foregroundStyle(WatchStyle.amber).accessibilityHidden(true)
    }
}
struct JarvisWatchAction: View {
    var title: String
    var kind: WatchGlyph.Kind
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                WatchGlyph(kind: kind).frame(width: 34, height: 26)
                Text(title).font(.system(.body, design: .rounded, weight: .semibold))
                Spacer(minLength: 0)
            }.padding(.horizontal, 14).frame(minHeight: 51).modifier(WatchSurface())
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}
