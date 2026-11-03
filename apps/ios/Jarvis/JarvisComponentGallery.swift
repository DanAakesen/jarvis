#if DEBUG
import JarvisCore
import SwiftUI

/// Debug-only gallery of the shared components: every button state, the orb at three sizes and the page scaffold.
/// It has no user-facing entry: it opens only in debug and UI-test builds, with `--component-gallery`, so reviewers
/// can compare the screenshot against the design board. Release builds do not compile it.
struct JarvisComponentGallery: View {
    @State private var galleryTab = "Notes"

    var body: some View {
        NavigationStack {
            JarvisPageScaffold(
                title: "Components",
                language: .en,
                actions: {
                    JarvisIconButton(title: "Refresh", systemImage: "arrow.clockwise", identifier: "gallery.header.refresh") {}
                },
                headline: {
                    JarvisPageHeadline(phrase: JarvisPagePhrase(markup: "Dan, {3 components} share {one look}."))
                },
                hero: {
                    JarvisPageHeroCard(title: "Orb") {
                        HStack(alignment: .center, spacing: 24) {
                            JarvisOrb(activity: .calm, size: 44)
                            JarvisOrb(activity: .listening, size: 96)
                            JarvisOrb(activity: .thinking, size: 160)
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Orb at three sizes")
                        .accessibilityIdentifier("gallery.orbs")
                    }
                },
                sections: { sections }
            )
        }
        .environmentObject(JarvisNavigationModel())
        .overlay(alignment: .topLeading) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("screen.componentGallery")
        }
    }

    private var sections: some View {
        VStack(alignment: .leading, spacing: 16) {
            JarvisPageHeroCard(title: "Icon buttons") {
                HStack(spacing: 12) {
                    JarvisIconButton(title: "Default", systemImage: "gearshape", identifier: "gallery.icon") {}
                    JarvisIconButton(title: "Busy", systemImage: "arrow.clockwise", identifier: "gallery.icon.busy", isBusy: true) {}
                    JarvisIconButton(title: "Disabled", systemImage: "plus", identifier: "gallery.icon.disabled", isDisabled: true) {}
                    JarvisIconButton(title: "Badge", systemImage: "bell", identifier: "gallery.icon.badge", badge: 3) {}
                    JarvisMenuButton(title: "Menu", systemImage: "plus", identifier: "gallery.menu") {
                        Button("One") {}
                        Button("Two") {}
                    }
                }
            }
            JarvisPageHeroCard(title: "Chat header: bell and menu") {
                HStack(spacing: 12) {
                    JarvisIconButton(title: "Bell", systemImage: "bell", identifier: "gallery.bell") {}
                    JarvisIconButton(title: "Bell with badge", systemImage: "bell", identifier: "gallery.bell.badge", badge: 3) {}
                    JarvisIconButton(title: "Sidebar", systemImage: "sidebar.trailing", identifier: "gallery.bell.menu") {}
                    JarvisIconButton(title: "Bell with large badge", systemImage: "bell", identifier: "gallery.bell.badge.large", badge: 120) {}
                }
            }
            JarvisPageHeroCard(title: "Tab strip") {
                JarvisTabStrip(
                    title: "Tabs",
                    identifierPrefix: "gallery.tabs",
                    items: ["Notes", "Tasks", "List", "Graph"].map { JarvisTabItem(tag: $0, title: $0) },
                    selection: $galleryTab
                )
            }
            JarvisPageHeroCard(title: "Labelled buttons") {
                VStack(alignment: .leading, spacing: 12) {
                    JarvisLabelledButton(title: "Label", identifier: "gallery.label") {}
                    JarvisLabelledButton(title: "With icon", systemImage: "checklist", identifier: "gallery.label.icon") {}
                    JarvisLabelledButton(title: "Busy", identifier: "gallery.label.busy", isBusy: true) {}
                    JarvisLabelledButton(title: "Disabled", identifier: "gallery.label.disabled", isDisabled: true) {}
                    JarvisLabelledButton(title: "Full width", identifier: "gallery.label.full", isFullWidth: true) {}
                }
            }
            JarvisPageHeroCard(title: "Sheet and composer") {
                HStack(spacing: 12) {
                    JarvisSheetConfirmButton(title: "Confirm") {}
                    JarvisSheetCloseButton(title: "Close") {}
                    JarvisComposerIconButton(title: "Send", systemImage: "paperplane.fill", identifier: "gallery.composer") {}
                }
            }
        }
    }
}
#endif
