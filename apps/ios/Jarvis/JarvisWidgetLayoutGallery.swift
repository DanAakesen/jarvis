#if DEBUG && targetEnvironment(simulator)
import JarvisCore
import SwiftUI
import WidgetKit

/// Actual extension views at a constrained medium-widget size. This checks native content layout;
/// WidgetKit's Xcode previews/device checks still own host margins, tinting and Home Screen rendering.
struct JarvisWidgetLayoutGallery: View {
    @Environment(\.dismiss) private var dismiss
    @State private var appearance: String

    init() {
        let requested = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--widget-appearance=") }
            .map { String($0.dropFirst("--widget-appearance=".count)) }
        _appearance = State(initialValue: ["dark", "light"].contains(requested ?? "") ? requested! : "dark")
    }

    private var appLanguage: JarvisAppLanguage { .en }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                JarvisTabStrip(
                    title: "Widget samples", identifierPrefix: "gallery.widgetAppearance",
                    items: [
                        JarvisTabItem(tag: "dark", title: "Dark"),
                        JarvisTabItem(tag: "light", title: "Light"),
                    ],
                    selection: $appearance
                )
                ScrollView {
                    VStack(spacing: 16) {
                        widget("workouts") { JarvisGymMediumWidgetView(entry: sample) }
                        widget("factory") { JarvisFactoryMediumWidgetView(entry: sample) }
                        widget("notes") { JarvisNotesMediumWidgetView(entry: sample) }
                    }
                    .padding(.bottom, 16)
                }
            }
            .padding(.horizontal, 16)
            .navigationTitle("Synthetic widget samples")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    JarvisSheetCloseButton(title: "Close") { dismiss() }
                }
            }
        }
        .preferredColorScheme(appearance == "dark" ? .dark : .light)
        .environment(\.dynamicTypeSize, .large)
        .presentationDetents([.large])
    }

    private var sample: JarvisWidgetEntry { JarvisWidgetSamples.entry(language: appLanguage) }

    private func widget<Content: View>(_ identifier: String, @ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16) // Identical to Jarvis*MediumWidget's existing configuration inset.
            .frame(width: 329, height: 155)
            .background(Color(uiColor: .systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 22))
            // Preserve action geometry while preventing touch and accessibility fixture writes.
            .disabled(true)
            .allowsHitTesting(false)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("widget.preview.\(identifier)")
    }
}
#endif
