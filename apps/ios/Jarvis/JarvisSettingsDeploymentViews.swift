import JarvisCore
import SwiftUI

struct JarvisDeploymentsSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var catalogue: JarvisModelCatalogue?
    @State private var loadGeneration = 0
    @State private var loading = true
    @State private var removing: String?
    @State private var error: String?
    @State private var notice: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    var body: some View {
        JarvisList {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).foregroundStyle(.secondary)
            }
            if loading && catalogue == nil {
                JarvisLoadingView(title: copy(.loading))
            } else if let catalogue {
                if catalogue.deployments.isEmpty {
                    Text(copy(.noItems)).foregroundStyle(.secondary)
                }
                ForEach(catalogue.deployments) { deployment in
                    VStack(alignment: .leading, spacing: JarvisDesignTokens.settingsSectionSpacing / 2) {
                        HStack {
                            Text(deployment.name)
                                .font(.body.weight(.medium))
                            Spacer()
                            if catalogue.source == "arm" {
                                JarvisIconButton(
                                    title: "\(copy(.removeDeployment)) \(deployment.name)",
                                    systemImage: "trash",
                                    identifier: "settings.deployment.remove",
                                    isDisabled: readOnly || removing != nil,
                                    tint: .red
                                ) { Task { await remove(deployment) } }
                                .accessibilityHint(readOnly ? copy(.readOnly) : "")
                            }
                        }
                        Text("\(deployment.model) · \(deployment.version) · \(deployment.sku)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("\(copy(.deploymentCapacity)): \(deployment.capacity)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if !deployment.capabilities.isEmpty {
                            Text(deployment.capabilities.joined(separator: " · "))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(minHeight: JarvisDesignTokens.settingsRowMinimumHeight)
                }
                if error != nil {
                    JarvisLabelledButton(
                        title: copy(.retry),
                        isDisabled: loading || removing != nil
                    ) { Task { await load(force: true) } }
                }
            } else {
                JarvisLabelledButton(title: copy(.retry), isDisabled: loading) { Task { await load(force: true) } }
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.deploymentsRow))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(force: true) }
        .task {
            if catalogue == nil { await load() }
        }
        .onDisappear { loadGeneration += 1; loading = false }

    }

    private func load(force: Bool = true) async {
        guard removing == nil else { return }
        loadGeneration += 1
        let generation = loadGeneration
        defer { if loadGeneration == generation { loading = false } }
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        let repository: JarvisRepository<JarvisModelCatalogue> = await JarvisAppCache.repository(.settings, scope: "deployments") { _ in
            .modified(try await client.loadModels(), validator: nil)
        }
        guard !Task.isCancelled, loadGeneration == generation else { return }
        for await update in repository.updates(force: force) {
            guard !Task.isCancelled, loadGeneration == generation else { return }
            switch update {
            case .cached(let fresh, _), .fresh(let fresh):
                catalogue = fresh
                error = nil
            case .refreshing: break
            case .failed(let failure, _):
                error = copy(.loadFailed)
                onFailure(failure)
            }
        }
        loading = false
    }

    private func remove(_ deployment: JarvisModelDeployment) async {
        guard let client, !readOnly, removing == nil else { return }
        loadGeneration += 1
        let generation = loadGeneration
        loading = false
        removing = deployment.name
        defer { removing = nil }
        error = nil
        notice = nil
        do {
            let result = try await client.removeDeployment(named: deployment.name)
            if result.status == "approval_pending" {
                notice = copy(.approvalPending)
            } else {
                await JarvisAppCache.invalidate(.settings, scope: "deployments")
                let fresh = try await client.loadModels()
                guard !Task.isCancelled, loadGeneration == generation else { return }
                catalogue = fresh
            }
        } catch {
            self.error = copy(.requestFailed)
            onFailure(error)
        }
        removing = nil
    }
}

struct JarvisNewDeploymentView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model = ""
    @State private var version = ""
    @State private var sku = ""
    @State private var capacity = ""
    @State private var saving = false
    @State private var submitted = false
    @State private var error: String?
    @State private var notice: String?

    private func copy(_ key: JarvisSettingsLocalizationKey) -> String {
        JarvisSettingsLocalization.string(key, language: language)
    }

    private var capacityValue: Int? {
        Int(capacity)
    }

    private var validDraft: Bool {
        guard let capacityValue else { return false }
        return JarvisSettingsLogic.validDeploymentInput(
            model: model,
            version: version,
            sku: sku,
            capacity: capacityValue
        )
    }

    var body: some View {
        JarvisForm {
            if let error {
                Text(error).foregroundStyle(.red)
            }
            if let notice {
                Text(notice).foregroundStyle(.secondary)
            }
            JarvisSettingsTextField(title: copy(.deploymentModel), text: $model,
                                    identifier: "settings.deployment.model")
                .disabled(readOnly || saving || submitted)
            JarvisSettingsTextField(title: copy(.deploymentVersion), text: $version,
                                    identifier: "settings.deployment.version")
                .disabled(readOnly || saving || submitted)
            JarvisSettingsTextField(title: copy(.deploymentSku), text: $sku,
                                    identifier: "settings.deployment.sku")
                .disabled(readOnly || saving || submitted)
            JarvisSettingsTextField(title: copy(.deploymentCapacity), text: $capacity,
                                    identifier: "settings.deployment.capacity", keyboard: .numberPad)
                .disabled(readOnly || saving || submitted)
        }
        .navigationTitle(copy(.addDeployment))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                JarvisSheetConfirmButton(
                    title: copy(.requestDeployment),
                    isWorking: saving,
                    isDisabled: client == nil || readOnly || submitted || !validDraft
                ) { Task { await requestDeployment() } }
                .accessibilityHint(client == nil ? copy(.unavailable) : (readOnly ? copy(.readOnly) : ""))
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .onChange(of: model) { _, _ in error = nil; notice = nil }
        .onChange(of: version) { _, _ in error = nil; notice = nil }
        .onChange(of: sku) { _, _ in error = nil; notice = nil }
        .onChange(of: capacity) { _, _ in error = nil; notice = nil }
    }

    private func requestDeployment() async {
        guard let client, validDraft, !readOnly, !saving, !submitted, let capacityValue else { return }
        saving = true
        error = nil
        notice = nil
        do {
            let result = try await client.requestDeployment(
                model: model,
                version: version,
                sku: sku,
                capacity: capacityValue
            )
            if result.status == "approval_pending" {
                submitted = true
                notice = copy(.approvalPending)
            } else {
                await JarvisAppCache.invalidate(.settings, scope: "deployments")
                dismiss()
            }
        } catch {
            self.error = copy(.requestFailed)
            onFailure(error)
        }
        saving = false
    }
}
