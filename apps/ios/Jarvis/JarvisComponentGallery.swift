#if DEBUG
import JarvisCore
import SwiftUI

/// Debug-only gallery of the shared components: every button state, the orb in every state and at every size, and
/// the page scaffold.
/// It has no user-facing entry: it opens only in debug and UI-test builds, with `--component-gallery`, so reviewers
/// can compare the screenshot against the design board. Release builds do not compile it.
struct JarvisComponentGallery: View {
    @State private var galleryTab = "Notes"
    @State private var sectionActionCount = 0
    #if targetEnvironment(simulator)
    @State private var showingWidgets = false
    #endif

    var body: some View {
        NavigationStack {
            JarvisPageScaffold(
                title: "Components",
                language: .en,
                actions: {
                    JarvisIconButton(title: "Refresh", systemImage: "arrow.clockwise", identifier: "gallery.header.refresh") {}
                    #if targetEnvironment(simulator)
                    JarvisIconButton(title: "Widgets", systemImage: "rectangle.grid.1x2", identifier: "gallery.widgets") {
                        showingWidgets = true
                    }
                    #endif
                },
                headline: {
                    JarvisPageHeadline(phrase: JarvisPagePhrase(markup: "Dan, {3 components} share {one look}."))
                },
                hero: {
                    JarvisPageHeroCard(title: "Orb") { orbShowcase }
                },
                sections: { sections }
            )
        }
        .environmentObject(JarvisNavigationModel())
        #if targetEnvironment(simulator)
        .sheet(isPresented: $showingWidgets) { JarvisWidgetLayoutGallery() }
        #endif
        .overlay(alignment: .topLeading) {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("screen.componentGallery")
        }
    }

    /// Every orb state animated at 96 pt, then the still pose at each detail level, as Live Activities, widgets and
    /// the Watch draw it.
    private var orbShowcase: some View {
        let states: [(String, JarvisOrbActivity)] = [
            ("Calm", .calm), ("Listening", .listening), ("Thinking", .thinking),
            ("Speaking", .speaking), ("Muted", .muted), ("Offline", .offline),
        ]
        return VStack(spacing: 16) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 12) {
                ForEach(states, id: \.0) { name, activity in
                    VStack(spacing: 6) {
                        JarvisOrb(activity: activity, size: 96)
                        Text(name).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            HStack(alignment: .center, spacing: 18) {
                JarvisOrb(activity: .calm, size: 18, isStatic: true)
                JarvisOrb(activity: .calm, size: 30, isStatic: true)
                JarvisOrb(activity: .calm, size: 46, isStatic: true)
                JarvisOrb(activity: .calm, size: 72, isStatic: true)
                JarvisOrb(activity: .calm, size: 128, isStatic: true)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Orb in every state and at five sizes")
        .accessibilityIdentifier("gallery.orbs")
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
            JarvisSectionHeadline("Section heading") {
                JarvisTextButton(title: "Log", identifier: "gallery.section.action") { sectionActionCount += 1 }
            }
            JarvisRowGroup {
                ForEach(0..<2, id: \.self) { index in
                    VStack(alignment: .leading, spacing: JarvisPageHeaderMetrics.rowLineSpacing) {
                        Text("Row \(index + 1)").accessibilityIdentifier("gallery.row.\(index).title")
                        Text("Supporting line").font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("gallery.row.\(index).detail")
                    }
                    .jarvisListRow(separator: index == 0)
                }
            }
            Text("Actions: \(sectionActionCount)").accessibilityIdentifier("gallery.section.result")
            JarvisPageLoadingView(title: "Loading", identifier: "gallery.page.loading")
        }
    }
}
#endif
