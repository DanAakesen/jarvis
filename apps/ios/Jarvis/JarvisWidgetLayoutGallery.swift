#if DEBUG && targetEnvironment(simulator)
import JarvisCore
import SwiftUI
import WidgetKit

/// Actual extension views at a constrained medium-widget size. This checks native content layout;
/// WidgetKit's Xcode previews/device checks still own host margins, tinting and Home Screen rendering.
struct JarvisWidgetLayoutGallery: View {
    @Environment(\.dismiss) private var dismiss
    @State private var language = "en"

    private var appLanguage: JarvisAppLanguage { language == "da" ? .da : .en }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                JarvisTabStrip(
                    title: "Widget samples", identifierPrefix: "gallery.widgetLanguage",
                    items: [JarvisTabItem(tag: "en", title: "English · Dark"), JarvisTabItem(tag: "da", title: "Dansk · Lys")],
                    selection: $language
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
        .preferredColorScheme(language == "da" ? .light : .dark)
        .environment(\.dynamicTypeSize, .large)
        .environment(\.widgetFamily, .systemMedium)
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
