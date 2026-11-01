import JarvisCore
import SwiftUI

struct JarvisFactoryReleaseListView: View {
    let releaseView: FactoryReleaseView
    let language: JarvisAppLanguage
    let searchText: String
    let onSelect: (FactoryRelease) -> Void

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var releases: [FactoryRelease] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return releaseView.releases }
        return releaseView.releases.filter {
            $0.version.localizedCaseInsensitiveContains(query) ||
                $0.sha.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if releases.isEmpty {
                    Text(copy.text(
                        searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? .emptyReleases
                            : .noSearchResults
                    ))
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, JarvisDesignTokens.factorySectionSpacing * 2)
                } else {
                    ForEach(releases) { release in
                        Button {
                            onSelect(release)
                        } label: {
                            HStack(alignment: .center, spacing: JarvisDesignTokens.factoryRowSpacing) {
                                VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                                    Text(release.version)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(.primary)
                                    HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                                        Text(copy.releaseStatus(release.status))
                                        Text(String(release.sha.prefix(7)))
                                            .monospaced()
                                        Text(JarvisFactoryLocalization.formattedDate(
                                            release.releasedAt ?? release.createdAt,
                                            language: language
                                        ))
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                                    .accessibilityHidden(true)
                            }
                            .contentShape(Rectangle())
                            .padding(.vertical, JarvisDesignTokens.factorySectionSpacing)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
            }
            .padding(.horizontal, JarvisDesignTokens.factoryHorizontalInset)
            .padding(.bottom, JarvisDesignTokens.factorySectionSpacing)
        }
        .accessibilityIdentifier("factory.releases")
    }
}

struct JarvisFactoryReleaseDetailView: View {
    let client: JarvisFactoryClient
    let project: FactoryProject
    let releaseView: FactoryReleaseView
    let release: FactoryRelease
    let language: JarvisAppLanguage

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var runs: [FactoryWorkflowRun] {
        releaseView.workflowRuns.filter { $0.releaseId == release.id }
    }
    private var deployments: [FactoryDeployment] {
        releaseView.deployments.filter { $0.releaseId == release.id }
    }
    private var linkedTaskIDs: [String] {
        JarvisFactoryPresentation.linkedTaskIDs(for: release, in: releaseView)
    }

    var body: some View {
        JarvisList {
            Section {
                LabeledContent(copy.text(.state), value: copy.releaseStatus(release.status))
                LabeledContent(copy.text(.commit), value: String(release.sha.prefix(12)))
                LabeledContent(
                    copy.text(.created),
                    value: JarvisFactoryLocalization.formattedDate(release.createdAt, language: language)
                )
                if let releasedAt = release.releasedAt {
                    LabeledContent(
                        copy.text(.released),
                        value: JarvisFactoryLocalization.formattedDate(releasedAt, language: language)
                    )
                }
                if let commitURL {
                    Link(destination: commitURL) {
                        Label(copy.text(.commit), systemImage: "arrow.up.right.square")
                    }
                }
            }

            Section(copy.text(.workflowRuns)) {
                if runs.isEmpty {
                    Text(copy.text(.noWorkflowRuns))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(runs) { run in
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                            Text(run.workflow)
                                .font(.body.weight(.medium))
                            Text(runStatus(run))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(String(run.headSha.prefix(12)))
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
                    }
                }
            }

            Section(copy.text(.deployments)) {
                if deployments.isEmpty {
                    Text(copy.text(.noDeployments))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(deployments) { deployment in
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                            Text(deployment.environment)
                                .font(.body.weight(.medium))
                            Text(deploymentStatus(deployment.status))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(JarvisFactoryLocalization.formattedDate(deployment.at, language: language))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
                    }
                }
            }

            Section(copy.text(.linkedTasks)) {
                if linkedTaskIDs.isEmpty {
                    Text(copy.text(.noLinkedTasks))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(linkedTaskIDs, id: \.self) { taskID in
                        NavigationLink {
                            JarvisFactoryTaskDetailView(
                                client: client,
                                taskID: taskID,
                                language: language
                            )
                        } label: {
                            Text("\(copy.text(.taskDetail)) #\(taskID)")
                        }
                    }
                }
            }

            Section(copy.text(.commits)) {
                if releaseView.graph?.truncated == true {
                    Label(copy.text(.historyTruncated), systemImage: "ellipsis.circle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if releaseView.graph?.commits.isEmpty != false {
                    Text(copy.text(.noCommits))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(releaseView.graph?.commits ?? []) { commit in
                        VStack(alignment: .leading, spacing: JarvisDesignTokens.factoryRowSpacing) {
                            Text(commit.message)
                                .font(.body)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: JarvisDesignTokens.factoryRowSpacing) {
                                Text(String(commit.sha.prefix(7)))
                                    .font(.caption.monospaced())
                                Text(commit.author)
                                    .font(.caption)
                                Text(JarvisFactoryLocalization.formattedDate(commit.committedAt, language: language))
                                    .font(.caption)
                            }
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, JarvisDesignTokens.factoryRowSpacing)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(release.version)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .environment(\.locale, language.locale)
    }

    private var commitURL: URL? {
        guard project.repo.range(of: #"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil,
              release.sha.range(of: #"^[0-9a-fA-F]{7,64}$"#, options: .regularExpression) != nil else {
            return nil
        }
        return URL(string: "https://github.com/\(project.repo)/commit/\(release.sha)")
    }

    private func runStatus(_ run: FactoryWorkflowRun) -> String {
        if run.status == "completed", run.conclusion == "success" {
            return copy.text(.success)
        }
        if run.status == "completed" {
            return copy.text(.failure)
        }
        if run.status == "queued" || run.status == "waiting" {
            return copy.text(.queued)
        }
        return run.status == "in_progress" ? copy.text(.running) : copy.text(.loading)
    }

    private func deploymentStatus(_ status: String) -> String {
        switch status.lowercased() {
        case "success", "succeeded", "completed": copy.text(.success)
        case "failed", "failure", "error": copy.text(.failure)
        case "queued", "waiting": copy.text(.queued)
        default: copy.text(.deploying)
        }
    }
}
