import JarvisCore
import SwiftUI

struct JarvisFactoryNewTaskSheet: View {
    let client: JarvisFactoryClient
    let projects: [FactoryProject]
    let onCreated: () -> Void
    let onPolicyUpdated: (FactoryProject) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedProjectID: String
    @State private var agent: FactoryAgent
    @State private var title = ""
    @State private var request = ""
    @State private var model = ""
    @State private var reasoning = ""
    @State private var deployments: [JarvisModelDeployment] = []
    @State private var policy: FactoryProjectPolicy
    @State private var savedPolicies: [String: FactoryProjectPolicy]
    @State private var creating = false
    @State private var savingPolicy = false
    @State private var createFailed = false
    @State private var policySaveFailed = false
    @State private var submissionsByDraft: [TaskDraftSubmission: FactoryTaskSubmission] = [:]

    private let language: JarvisAppLanguage

    private var copy: JarvisFactoryCopy { JarvisFactoryCopy(language: language) }
    private var selectedProject: FactoryProject? { projects.first { $0.id == selectedProjectID } }
    private var currentDraft: TaskDraftSubmission {
        TaskDraftSubmission(
            projectID: selectedProjectID,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            request: request.trimmingCharacters(in: .whitespacesAndNewlines),
            agent: agent,
            model: optionalValue(model),
            reasoning: optionalValue(reasoning)
        )
    }

    init(
        client: JarvisFactoryClient,
        projects: [FactoryProject],
        selectedProject: FactoryProject,
        language: JarvisAppLanguage,
        onPolicyUpdated: @escaping (FactoryProject) -> Void,
        onCreated: @escaping () -> Void
    ) {
        self.client = client
        self.projects = projects
        self.language = language
        self.onPolicyUpdated = onPolicyUpdated
        self.onCreated = onCreated
        _selectedProjectID = State(initialValue: selectedProject.id)
        _agent = State(initialValue: selectedProject.defaultAgent)
        _policy = State(initialValue: selectedProject.policy)
        _savedPolicies = State(initialValue: [selectedProject.id: selectedProject.policy])
    }

    var body: some View {
        NavigationStack {
            JarvisForm {
                Section {
                    Picker(copy.text(.projectLabel), selection: $selectedProjectID) {
                        ForEach(projects) { project in
                            Text(project.name).tag(project.id)
                        }
                    }
                    .disabled(savingPolicy)
                    Picker(copy.text(.agentLabel), selection: $agent) {
                        ForEach(FactoryAgent.allCases, id: \.rawValue) { option in
                            Text(copy.agent(option)).tag(option)
                        }
                    }
                }

                Section {
                    TextField(copy.text(.titleField), text: $title)
                        .accessibilityLabel(copy.text(.titleField))
                    TextField(copy.text(.requestField), text: $request, axis: .vertical)
                        .lineLimit(JarvisDesignTokens.factoryMultilineMinimumLines...JarvisDesignTokens.factoryMultilineMaximumLines)
                        .accessibilityLabel(copy.text(.requestField))
                }

                Section {
                    if deployments.isEmpty {
                        TextField(copy.text(.modelOptional), text: $model)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField(copy.text(.reasoningOptional), text: $reasoning)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } else {
                        Picker(copy.text(.modelOptional), selection: $model) {
                            Text(copy.text(.defaultOption)).tag("")
                            ForEach(JarvisFactoryModelOptions.modelNames(deployments), id: \.self) { name in
                                Text(name).tag(name)
                            }
                        }
                        .accessibilityIdentifier("factory.newTask.model")
                        Picker(copy.text(.reasoningOptional), selection: $reasoning) {
                            Text(copy.text(.defaultOption)).tag("")
                            ForEach(
                                JarvisFactoryModelOptions.reasoningEfforts(deployments, selectedModel: model),
                                id: \.self
                            ) { effort in
                                Text(effort).tag(effort)
                            }
                        }
                        .accessibilityIdentifier("factory.newTask.reasoning")
                    }
                }
                .task {
                    deployments = (try? await client.deployedModels()) ?? []
                }
                .onChange(of: model) { _, _ in
                    if !deployments.isEmpty,
                       !JarvisFactoryModelOptions.reasoningEfforts(deployments, selectedModel: model).contains(reasoning) {
                        reasoning = ""
                    }
                }

                Section {
                    Picker(copy.text(.completionPolicy), selection: $policy) {
                        Text(copy.text(.deliverPullRequest)).tag(FactoryProjectPolicy.deliverPullRequest)
                        Text(copy.text(.completeWithoutDeployment)).tag(FactoryProjectPolicy.completeWithoutDeployment)
                    }
                    .disabled(savingPolicy)
                    if savingPolicy {
                        JarvisLoadingView(title: copy.text(.policySaving))
                    }
                    if policySaveFailed {
                        Text(copy.text(.policySaveFailed))
                            .foregroundStyle(.red)
                        JarvisLabelledButton(title: copy.text(.retry), isDisabled: savingPolicy) {
                            Task { await savePolicy(policy) }
                        }
                    }
                }

                if createFailed {
                    Section {
                        Text(copy.text(.createFailed))
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(copy.text(.newTask))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                JarvisSheetToolbar(
                    confirmTitle: copy.text(.createTask),
                    closeTitle: copy.text(.cancel),
                    isWorking: creating,
                    isConfirmDisabled: savingPolicy || policySaveFailed || !isValidDraft,
                    onConfirm: { Task { await createTask() } },
                    onClose: { dismiss() }
                )
            }
            .environment(\.locale, language.locale)
            .onChange(of: selectedProjectID) { _, projectID in
                guard let project = projects.first(where: { $0.id == projectID }) else { return }
                agent = project.defaultAgent
                policy = savedPolicies[projectID] ?? project.policy
                policySaveFailed = false
            }
            .onChange(of: policy) { oldValue, newValue in
                guard oldValue != newValue else { return }
                Task { await savePolicy(newValue) }
            }
        }
    }

    private var isValidDraft: Bool {
        FactoryTaskSubmission(
            projectId: currentDraft.projectID,
            title: currentDraft.title,
            request: currentDraft.request,
            agent: currentDraft.agent,
            modelOverride: currentDraft.model,
            reasoningOverride: currentDraft.reasoning,
            submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        ).isValid
    }

    private func createTask() async {
        guard !creating, isValidDraft, !policySaveFailed else { return }
        creating = true
        createFailed = false
        defer { creating = false }
        let draft = currentDraft
        let submission: FactoryTaskSubmission
        if let cachedSubmission = submissionsByDraft[draft] {
            submission = cachedSubmission
        } else {
            submission = FactoryTaskSubmission(
                projectId: draft.projectID,
                title: draft.title,
                request: draft.request,
                agent: draft.agent,
                modelOverride: draft.model,
                reasoningOverride: draft.reasoning
            )
            submissionsByDraft[draft] = submission
        }
        do {
            let task = try await client.createTask(submission)
            await JarvisFactoryLiveActivityController.update(task: task, language: language)
            submissionsByDraft[draft] = nil
            onCreated()
        } catch {
            createFailed = true
        }
    }

    private func savePolicy(_ value: FactoryProjectPolicy) async {
        guard !savingPolicy,
              let project = projects.first(where: { $0.id == selectedProjectID }),
              (savedPolicies[selectedProjectID] ?? project.policy) != value else {
            policySaveFailed = false
            return
        }
        savingPolicy = true
        policySaveFailed = false
        defer { savingPolicy = false }
        do {
            let updatedProject = try await client.updatePolicy(projectId: selectedProjectID, policy: value)
            savedPolicies[selectedProjectID] = value
            onPolicyUpdated(updatedProject)
        } catch {
            policySaveFailed = true
        }
    }

    private func optionalValue(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct TaskDraftSubmission: Hashable {
    let projectID: String
    let title: String
    let request: String
    let agent: FactoryAgent
    let model: String?
    let reasoning: String?
}
