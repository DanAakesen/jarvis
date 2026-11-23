import JarvisCore
import SwiftUI

/// Watch-specific equivalents of the iOS shared controls; UIKit-backed controls cannot link into watchOS.
enum WatchStyle {
    static let amber = Color(red: 1, green: 180 / 255, blue: 92 / 255)
    static let stone = Color(red: 201 / 255, green: 191 / 255, blue: 174 / 255)
    static let surface = Color(white: 0.10)
}
/// Neutral dark smoked glass for floating Watch controls. Reduce Transparency swaps the blur for a solid fill.
struct WatchGlass<S: Shape>: ViewModifier {
    var shape: S
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        content.background {
            if reduceTransparency {
                shape.fill(WatchStyle.surface)
            } else {
                shape.fill(Color.black.opacity(0.4)).background(.ultraThinMaterial, in: shape)
            }
        }
        .overlay {
            shape.stroke(.white.opacity(reduceTransparency ? 0.3 : 0.18), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }
}
extension View {
    func watchGlass<S: Shape>(in shape: S) -> some View { modifier(WatchGlass(shape: shape)) }
}
/// Round glass icon button with an amber symbol and a native-size hit target.
struct WatchIconButton: View {
    var systemName: String
    var label: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: systemName).font(.system(size: 17, weight: .semibold))
                .foregroundStyle(WatchStyle.amber)
                .frame(width: 44, height: 44).watchGlass(in: Circle()).contentShape(Circle())
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}
/// Glass capsule button with an icon and a label; the label drops out at accessibility text sizes so the icon keeps a native hit target.
struct WatchLabelledButton: View {
    var title: String
    var systemName: String
    var tint: Color = WatchStyle.amber
    var action: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemName).font(.system(size: 16, weight: .semibold))
                if !typeSize.isAccessibilitySize {
                    Text(title).font(.system(.footnote, design: .rounded, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity, minHeight: 44).watchGlass(in: Capsule()).contentShape(Capsule())
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}
/// Soft black scrim that keeps floating controls readable over scrolling text; solid when transparency is reduced.
struct WatchEdgeFade: View {
    var edge: VerticalEdge
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body: some View {
        LinearGradient(colors: [.black.opacity(reduceTransparency ? 1 : 0), .black.opacity(reduceTransparency ? 1 : 0.88)],
                       startPoint: edge == .bottom ? .top : .bottom, endPoint: edge == .bottom ? .bottom : .top)
            .allowsHitTesting(false).accessibilityHidden(true)
    }
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
/// The Jarvis orb on the Watch: the shared cognitive lattice from JarvisCore. Still unless a voice session is live,
/// so a glyph in a list or complication costs no animation.
struct WatchOrb: View {
    var activity: JarvisOrbActivity = .calm
    var isAnimated = false

    var body: some View {
        JarvisLatticeOrbView(activity: activity, isStatic: !isAnimated)
            .aspectRatio(1, contentMode: .fit)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}
struct WatchGlyph: View {
    enum Kind { case voice, dictate, chat, tasks, factory, logLift }
    var kind: Kind
    var body: some View {
        Group {
            switch kind {
            case .voice: WatchOrb()
            case .dictate:
                HStack(spacing: 2) {
                    WatchMiniWave()
                    Image(systemName: "mic.fill").resizable().scaledToFit().frame(width: 12)
                    WatchMiniWave()
                }
            case .chat: Image(systemName: "ellipsis.bubble").resizable().scaledToFit()
            case .tasks: Image(systemName: "checklist").resizable().scaledToFit()
            case .factory: Image(systemName: "chevron.left.forwardslash.chevron.right").resizable().scaledToFit()
            case .logLift:
                VStack(spacing: 2) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                    Image(systemName: "dumbbell.fill").font(.system(size: 18, weight: .semibold))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
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
            }.padding(.horizontal, 14).frame(minHeight: 46).modifier(WatchSurface())
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}

/// Shared production artwork; the DEBUG screen shows it at circular accessory size.
struct WatchLogLiftComplicationView: View {
    var body: some View {
        WatchGlyph(kind: .logLift).padding(5).frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore).accessibilityLabel("Log lift")
    }
}

struct WatchPrimaryAction: View {
    var title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(.body, design: .rounded, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }.buttonStyle(.borderedProminent).tint(WatchStyle.amber).foregroundStyle(.black)
    }
}

private struct WatchMiniWave: View {
    private let heights: [CGFloat] = [3, 8, 14, 8, 3]
    var body: some View {
        HStack(spacing: 1) {
            ForEach(heights.indices, id: \.self) { i in Capsule().frame(width: 1, height: heights[i]) }
        }.frame(width: 9, height: 14)
    }
}
