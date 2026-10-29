# Managed chat comparison provisioning

This is local preparation for one separate agent named
`jarvis-main-copilot-preview`. The script never changes `jarvis`, invokes a model,
creates credentials, assigns roles, creates connections, or deletes resources.
No provisioning or live verification ran while preparing it.

Manual Deploy [40877005757](https://github.com/DanAakesen/jarvis/actions/runs/40877005757)
reached `agent_identity_unverified` on 29 October 2026. That check follows readback
of one active, exact comparison-agent version and precedes endpoint pinning,
backend target configuration and the canary. The comparison resource therefore
exists; do not create a replacement or another version. The combined failure
does not distinguish agent state, optional identity status and principal ID, so
no missing grant or exact failing field is proven.

Microsoft's [governance contract](https://learn.microsoft.com/en-us/azure/foundry/control-plane/govern-agent-infrastructure-entra-admin)
defines `state` as effective runtime enablement and identity `status` as optional,
omitted when unset. The provisioner now accepts omitted/null status only with an
enabled agent and valid principal UUID. It still refuses explicit disabled or
unknown status, disabled/unknown effective state and invalid principal IDs, with
distinct fixed failure codes. Readback after pinning must retain that principal;
optional status becoming populated does not change identity. These checks neither
enable an agent nor change Entra state or roles. The existing exact-name/version/
definition checks run before any reuse or endpoint write. This correction has
not yet been exercised live. All 30 provisioning/handoff/deploy-plan tests,
scoped Ruff, compilation and shell syntax checks pass locally; exact-head CI and
live handoff remain required.

The target is the existing Jarvis project in Sweden Central:

- Project ID: `/subscriptions/0ac7d719-89bc-4100-be87-a79d33e953a7/resourceGroups/rg-jarvis/providers/Microsoft.CognitiveServices/accounts/jarvis-20261003200000-rmw7kae3bza6a/projects/jarvis-20261003200000`
- Project endpoint: `https://jarvis-20261003200000-rmw7kae3bza6a.services.ai.azure.com/api/projects/jarvis-20261003200000`
- Model deployment: `gpt-6.1-terra`; reasoning effort: `high`.
- Definition: prompt agent, `microsoft_copilot_preview` harness, complete existing
  Jarvis function catalogue with `strict: false`, one
  `microsoft_copilot_toolset_preview` with `default_config.enabled: false`.

The script checks actual ARM project/account location and existing deployment
metadata before agent writes. These observations establish target configuration,
not live model acceptance or harness support for this deployment.

Microsoft's [harness guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-tools-skills-copilot-harness)
describes new-agent creation, the `MicrosoftCopilot=V1Preview` opt-in, function
tools and disabled built-ins. It requires caller Foundry User access. The
instance identity needs its own project grant for Toolbox/generated-file use;
this candidate uses neither. The existing deployment OIDC principal already has
project Foundry User/Project Manager through the normal deployment path. This
script adds no grants. Any real permission rejection must be assessed for the
specific action and target before requesting an expansion.

## Private manifest input

`--manifest` must be a private UTF-8 JSON file assembled from the authorized
current Jarvis application/agent read, with exactly these top-level keys:

```json
{"instructions":"<current approved instructions>","tools":[{"type":"function","name":"<existing tool>","description":"<current description>","parameters":{"type":"object","properties":{}},"strict":false}]}
```

Supply every current function, retaining exact parameter schemas and descriptions.
Do not use the smoke subset or a manually curated list. The script sorts functions
by name without changing their schemas. It rejects duplicate names, nonfunction
tools, names containing `___`, and enabled strict mode. No private manifest,
instructions, activation file, CLI stderr or provider body belongs in logs or
uploaded artifacts.

The explicit manual job obtains this file through the existing hosted agent's
fixed `managed_definition_manifest` Invocations operation. The current deployment
OIDC identity already has Foundry User authorization to invoke that endpoint. The
hosted bridge uses its existing backend authorization to read the full current
catalogue and returns static normal English chat instructions plus function
schemas. This operation executes no tool or model and includes no user context,
personal settings or credentials. There is no new backend role or token relay.

## Commands and state transitions

For a private manifest already present at `$RUNNER_TEMP/managed-manifest.json`,
validate locally first. The command without `--apply` makes no Azure calls:

```bash
python .github/scripts/provision_managed_chat.py \
  --project-id "$project_id" \
  --project-endpoint "$project_endpoint" \
  --manifest "$RUNNER_TEMP/managed-manifest.json" \
  --output "$RUNNER_TEMP/managed-activation.json"
```

The two target variables must equal the exact project above. After review, run the
same command with `--apply` using the already authenticated normal deployment CLI.
No `az login`, token export, SDK install or additional role step is needed here.
The script captures `az rest` output privately and uses restricted temporary body
files, rather than putting prompts or tools in process arguments.

The apply path performs:

1. Read ARM account/project/deployment metadata using the existing API versions.
2. Read all bounded agent inventory pages. If the comparison name is absent,
   `POST {projectEndpoint}/agents?api-version=v1` once, with its new definition and
   the version metadata marker `jarvis_migration=managed-chat-1350`.
3. Read the agent and all its versions, including drafts. Require exactly one
   version, the marker, exact normalized definition, active status and active
   instance identity principal and effective enabled state, accepting documented
   unset identity status. Pending version `creating` status has bounded read-only polling.
   Existing-name ambiguity stops without writing a new version.
4. Pin only this agent's endpoint by `PATCH /agents/jarvis-main-copilot-preview`
   with `agent_endpoint.version_selector.version_selection_rules` containing one
   `FixedRatio` rule for the concrete version at `traffic_percentage: 100`.
   An already identical selector requires no write.
5. Read back the selector, identity and version definition. Write a new activation
   file with mode `0600`, refusing existing output paths. Print only
   `managed_chat_provisioned`; failures print a fixed code.

The endpoint selector shape follows Microsoft's
[configuration guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-agent).
An exact existing single-version match can be reused without creating a version.
Definition changes and multiple versions require review; they never silently
produce a replacement version. Mutations are not retried after errors or uncertain
outcomes. Inspect the existing candidate before rerunning.

`POST /agents` can create a version for an existing name; the documented API does
not promise atomic create-only behavior. Use the existing shared deployment
concurrency group and ensure no external writer is provisioning this name. The
inventory check is not a distributed lock. The script never targets `jarvis`.

## Fingerprint and activation handoff

The shared standard-library helper
`agents/jarvis/managed_definition_fingerprint.py` normalizes the actual provider
readback after validating it against the intended definition. Its canonical object
is:

```text
{"projectEndpoint": endpoint-without-trailing-slash,
 "agentName": name, "version": version, "definition": normalized-actual-definition}
```

It uses Python `json.dumps(..., ensure_ascii=False, sort_keys=True,
separators=(',', ':'), allow_nan=False)`, UTF-8 encoding and lowercase SHA-256 hex.
Normalization puts the disabled toolset first and sorts functions by name. It
preserves parameter data and array order; only supported benign null/default empty
fields are discarded. The live bridge recomputes the same hash before claiming or
invoking a managed turn.

The private output contains exactly `projectEndpoint`, `agentName`, `version` and
`fingerprint`. Parent integration maps these to the existing project endpoint and
`FOUNDRY_COPILOT_AGENT_NAME`, `FOUNDRY_COPILOT_AGENT_VERSION`,
`FOUNDRY_COPILOT_DEFINITION_SHA256`. Provisioning alone must not mark the runtime
available. A new agent endpoint exists immediately after creation; only the
separate comparison option may be wired to it.

## Explicit manual deployment integration

`deploy.yml` now exposes boolean `workflow_dispatch` input
`provision_managed_chat`, default `false`. Its separate
`managed-chat-comparison` job requires main, explicit true input, successful exact
qualification through `plan`, successful deterministic `smoke` readiness and
successful or compatible skipped infra/backend/agent jobs. It retains
`jarvis-production-deploy` concurrency and the current OIDC login permissions.
Normal pushes and dispatches with the default false input never run this job.

The handoff script `.github/scripts/provision_managed_chat_handoff.sh` reads
existing infrastructure outputs, fetches the manifest through the fixed existing
hosted operation, provisions the comparison, validates its private activation
file and updates only these existing-backend environment variables:

- `FOUNDRY_COPILOT_AGENT_NAME`
- `FOUNDRY_COPILOT_AGENT_VERSION`
- `FOUNDRY_COPILOT_DEFINITION_SHA256`

It preserves other environment values and the normal agent/model defaults. It
then follows the existing bounded `latestRevisionName == latestReadyRevisionName`
readiness pattern and calls the fixed `managed_text_canary` hosted operation.
The canary uses the actual bridge credential for one synthetic managed text turn,
executes no backend tool and cleans up only its own canary conversation. The job
requires `status: ok`, model `gpt-6.1-terra` and effort `high`; it prints no returned
text or raw provider error. Each invocation has the existing 210-second bound.
The job's 20-minute timeout accommodates the existing readiness loop. There is no
new grant, credential, connection or automatic mutation retry.

All manifest, operation, CLI error and activation files stay in a private
`RUNNER_TEMP` directory with `umask 077` and are removed on exit. None is uploaded.
A failure after backend configuration leaves that configuration visible for
review; it does not reset the target, invoke a fallback or claim success.

This is a comparison configuration handoff, not full release acceptance. The
normal live conversation/research acceptance job and release receipt remain
independent; this canary cannot turn their failures into accepted releases.

A future Bicep infrastructure deployment can remove these three ad hoc backend
values. Preserve or reapply the exact reviewed activation tuple after such a
deployment before another comparison, or persist it through reviewed optional
Bicep parameters. Provisioning another version or changing the fingerprint is not
a substitute for preserving the existing tuple. Runtime parity and uncertain-turn
recovery still need their own qualification. No live workflow dispatch occurred
while preparing this change.

## Offline checks

```bash
PYTHONPATH=.github/scripts python -m unittest discover \
  -s .github/scripts/tests -p 'test_provision_managed_chat.py'
PYTHONPATH=.github/scripts python -m unittest discover \
  -s .github/scripts/tests -p 'test_managed_chat_handoff.py'
bash -n .github/scripts/provision_managed_chat_handoff.sh
python -m compileall -q .github/scripts/provision_managed_chat.py
```

Fixtures cover exact reuse, name/version ambiguity, private bodies/output,
no mutation retry, complete function schemas, disabled built-ins and target
preflight failures. They provide no live Azure authorization or inference proof.
