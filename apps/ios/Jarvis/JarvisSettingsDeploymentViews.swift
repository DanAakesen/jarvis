import JarvisCore
import SwiftUI

struct JarvisDeploymentsSettingsView: View {
    let client: JarvisSettingsClient?
    let language: JarvisAppLanguage
    let readOnly: Bool
    let onFailure: (Error) -> Void

    @State private var catalogue: JarvisModelCatalogue?
    @State private var loading = true
    @State private var removing: String?
    @State private var pendingRemoval: JarvisModelDeployment?
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
                ProgressView(copy(.loading))
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
                                Button(role: .destructive) {
                                    pendingRemoval = deployment
                                } label: {
                                    Image(systemName: "trash")
                                        .frame(
                                            width: JarvisDesignTokens.settingsControlHeight,
                                            height: JarvisDesignTokens.settingsControlHeight
                                        )
                                }
                                .disabled(readOnly || removing != nil)
                                .accessibilityLabel("\(copy(.removeDeployment)) \(deployment.name)")
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
                if let error {
                    Button(copy(.retry)) { Task { await load() } }
                        .disabled(loading || removing != nil)
                }
            } else {
                Button(copy(.retry)) { Task { await load() } }
            }
        }
        .listStyle(.insetGrouped)
        .jarvisAmbientBackground()
        .navigationTitle(copy(.deploymentsRow))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading || removing != nil)
                .accessibilityLabel(copy(.refresh))
            }
        }
        .task {
            if catalogue == nil { await load() }
        }
        .confirmationDialog(
            copy(.removeDeploymentConfirm),
            isPresented: Binding(
                get: { pendingRemoval != nil },
                set: { if !$0 { pendingRemoval = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(copy(.removeDeployment), role: .destructive) {
                guard let pendingRemoval else { return }
                Task { await remove(pendingRemoval) }
            }
            Button(copy(.cancel), role: .cancel) { pendingRemoval = nil }
        }
    }

    private func load() async {
        guard let client else {
            error = copy(.unavailable)
            loading = false
            return
        }
        loading = true
        do {
            catalogue = try await client.loadModels()
            error = nil
        } catch {
            self.error = copy(.loadFailed)
            onFailure(error)
        }
        loading = false
    }

    private func remove(_ deployment: JarvisModelDeployment) async {
        guard let client, !readOnly, removing == nil else { return }
        removing = deployment.name
        error = nil
        notice = nil
        do {
            let result = try await client.removeDeployment(named: deployment.name)
            if result.status == "approval_pending" {
                notice = copy(.approvalPending)
            } else {
                catalogue = try await client.loadModels()
            }
        } catch {
            self.error = copy(.requestFailed)
            onFailure(error)
        }
        pendingRemoval = nil
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
            TextField(copy(.deploymentModel), text: $model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(readOnly || saving || submitted)
            TextField(copy(.deploymentVersion), text: $version)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(readOnly || saving || submitted)
            TextField(copy(.deploymentSku), text: $sku)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(readOnly || saving || submitted)
            TextField(copy(.deploymentCapacity), text: $capacity)
                .keyboardType(.numberPad)
                .disabled(readOnly || saving || submitted)
        }
        .navigationTitle(copy(.addDeployment))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(saving ? copy(.saving) : copy(.requestDeployment)) {
                    Task { await requestDeployment() }
                }
                .disabled(readOnly || saving || submitted || !validDraft)
            }
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
                dismiss()
            }
        } catch {
            self.error = copy(.requestFailed)
            onFailure(error)
        }
        saving = false
    }
}
