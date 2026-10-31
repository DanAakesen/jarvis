import JarvisCore
import SwiftUI

struct FactoryTaskActivitySurface: View {
    let factoryTitle: String
    let state: String
    let activity: String?
    let startedAt: Date?
    let language: JarvisAppLanguage

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.orange)
                    .frame(width: 42, height: 42)
                    .background(.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(factoryTitle)
                        .font(.headline)
                    Text(state)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let activity {
                        Text(activity)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                if let startedAt {
                    Text(startedAt, style: .timer)
                        .font(.system(.title3, design: .rounded, weight: .semibold))
                        .monospacedDigit()
                        .accessibilityLabel(
                            JarvisFactoryLocalization.string(.started, language: language)
                        )
                }
            }
            ProgressView()
                .progressViewStyle(.linear)
                .tint(.orange)
                .accessibilityLabel(
                    JarvisFactoryLocalization.string(.activityProgress, language: language)
                )
        }
        .padding(16)
    }
}
