import JarvisCore
import SwiftUI

/// The elapsed clock belongs to the assistant turn inside the scrolling transcript.
struct JarvisChatWorkHeader: View {
    let startedAt: Date
    let isReconnecting: Bool
    let language: JarvisAppLanguage
    let identifier: String

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
            Text(JarvisChatLocalization.string(isReconnecting ? .turnReconnectingFor : .turnWorkingFor, language: language)
                 + " " + ChatWorkProgress.elapsed(from: startedAt, to: context.date))
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier(identifier)
        }
        Divider()
    }
}
