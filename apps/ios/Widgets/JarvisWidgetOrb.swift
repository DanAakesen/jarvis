import JarvisCore
import SwiftUI

/// The Jarvis orb for the Home widgets: the shared cognitive lattice from JarvisCore, drawn once in its still pose
/// (a widget cannot animate) and scaled by `size` only. At widget sizes it uses the reduced detail levels.
struct JarvisWidgetOrb: View {
    var size: CGFloat

    var body: some View {
        JarvisLatticeOrbView(activity: .calm, isStatic: true)
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}
