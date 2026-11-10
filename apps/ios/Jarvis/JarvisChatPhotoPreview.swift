import JarvisCore
import SwiftUI

struct JarvisChatPhotoPreview: View {
    @Environment(\.displayScale) private var displayScale
    let name: String
    let size: CGFloat
    let language: JarvisAppLanguage
    var localData: Data?
    var loadData: (() async throws -> Data)?
    @State private var image: CGImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        Group {
            if let image {
                photo(image)
                    .accessibilityLabel(name)
                    .accessibilityAddTraits(.isImage)
                    .accessibilityIdentifier("chat.photo.loaded")
            } else if failed {
                VStack(spacing: JarvisDesignTokens.chatMessageDetailSpacing) {
                    if localData != nil {
                        Image(systemName: "photo.badge.exclamationmark")
                            .accessibilityLabel("\(copy(.photoUnavailable)), \(name)")
                    } else {
                        Label(copy(.photoUnavailable), systemImage: "photo.badge.exclamationmark")
                            .font(.caption)
                    }
                    if loadData != nil {
                        JarvisLabelledButton(title: copy(.photoRetry)) { attempt += 1 }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(name)
                .accessibilityIdentifier("chat.photo.unavailable")
            } else {
                JarvisLoadingView(size: .inline)
                    .accessibilityHidden(false)
                    .accessibilityLabel("\(copy(.photoLoading)), \(name)")
            }
        }
        .frame(width: size, alignment: .trailing)
        .frame(minHeight: size)
        .task(id: attempt) {
            failed = false
            do {
                let data: Data
                if let localData { data = localData }
                else if let loadData { data = try await loadData() }
                else { throw JarvisClientError.invalidRequest }
                let thumbnail = await JarvisChatPhotoDecoder.shared.thumbnail(
                    data, maximumPixelSize: Int(size * displayScale)
                )
                try Task.checkCancellation()
                image = thumbnail
                failed = thumbnail == nil
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }

    private func copy(_ key: JarvisChatLocalizationKey) -> String {
        JarvisChatLocalization.string(key, language: language)
    }

    @ViewBuilder
    private func photo(_ image: CGImage) -> some View {
        let photo = Image(image, scale: displayScale, label: Text(name)).resizable()
        let shape = RoundedRectangle(cornerRadius: JarvisDesignTokens.surfaceRadius)
        if localData != nil {
            photo.scaledToFill()
                .frame(width: size, height: size)
                .clipShape(shape)
        } else {
            photo.scaledToFit()
                .clipShape(shape)
                .frame(width: size, height: size, alignment: .topTrailing)
        }
    }
}
