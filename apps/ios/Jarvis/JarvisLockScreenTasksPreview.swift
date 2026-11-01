import JarvisCore
import SwiftUI

struct JarvisLockScreenTasksPreview: View {
    let language: JarvisAppLanguage

    private let startedAt = Date.now.addingTimeInterval(-4 * 60)
    private let expiresAt = Date.now.addingTimeInterval(5 * 60)

    private var factoryTitle: String {
        JarvisFactoryLocalization.string(.title, language: language)
    }

    private var approvalText: String {
        JarvisApprovalLocalization.string(.previewSummary, language: language)
    }

    private var expirationText: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = language.locale
        formatter.dateTimeStyle = .named
        let relative = formatter.localizedString(for: expiresAt, relativeTo: Date.now)
        let template = JarvisApprovalLocalization.string(.expires, language: language)
        return String(format: template, locale: language.locale, arguments: [relative])
    }

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                Text(
                    Date.now.formatted(
                        .dateTime.weekday(.wide).day().month(.wide).locale(language.locale)
                    )
                )
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(Date.now, style: .time)
                    .font(.system(size: 78, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .padding(.bottom, 24)

                Spacer(minLength: 0)

                VStack(spacing: 12) {
                    FactoryTaskActivitySurface(
                        factoryTitle: factoryTitle,
                        state: JarvisFactoryLocalization.string(.running, language: language),
                        activity: JarvisFactoryLocalization.string(.checksPending, language: language),
                        startedAt: startedAt,
                        language: language
                    )
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28))

                    approvalNotification
                }

                Spacer(minLength: 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 56)
            .padding(.bottom, 64)
        }
        .environment(\.locale, language.locale)
    }

    private var approvalNotification: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                JarvisOrbView(activity: .calm, diameter: 38)
                    .frame(width: 38, height: 38)
                    .accessibilityHidden(true)
                Text("Jarvis")
                    .font(.headline)
                Spacer()
                Text(JarvisApprovalLocalization.string(.notificationNow, language: language))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(approvalText)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
            Text(expirationText)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack {
                Text(JarvisApprovalLocalization.string(.approve, language: language))
                Spacer()
                Text(JarvisApprovalLocalization.string(.decline, language: language))
            }
            .font(.body.weight(.medium))
            .foregroundStyle(.orange)
            .padding(.top, 10)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(.primary.opacity(0.12))
                    .frame(height: 1)
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28))
    }
}
